import { describe, it, expect } from "vitest";
import type { Event } from "nostr-tools";
import {
  filterSpamEvents,
  isMachineReadableContent,
  classifyProfileResolution,
  mutePubkey,
  unmutePubkey,
  addReportedItem,
  removeReportedItem,
  onMuteChange,
  normalizeForCrossDup,
  buildCrossAuthorWaveSet,
  type SpamFilterOptions,
} from "./spam-filter";

const ev = (over: Partial<Event>): Event =>
  ({ id: Math.random().toString(36).slice(2), pubkey: "author1", created_at: 1, kind: 1, tags: [], content: "hello there friend", sig: "" , ...over }) as Event;

describe("filterSpamEvents — Discover safe floor", () => {
  it("readableKinds drops events of unlisted kinds", () => {
    const events = [ev({ kind: 1 }), ev({ kind: 6 }), ev({ kind: 9999 })];
    const out = filterSpamEvents(events, { readableKinds: new Set([1, 6]) });
    expect(out.map((e) => e.kind).sort()).toEqual([1, 6]);
  });

  it("languageAllowed drops disallowed unfollowed authors but keeps follows", () => {
    const wanted = ev({ pubkey: "en_author", content: "keep me" });
    const unwanted = ev({ pubkey: "jp_author", content: "drop me" });
    const followed = ev({ pubkey: "friend", content: "drop me" });
    const out = filterSpamEvents([wanted, unwanted, followed], {
      follows: new Set(["friend"]),
      languageAllowed: (e) => e.pubkey === "en_author" || e.pubkey === "friend" ? true : false,
    });
    expect(out.map((e) => e.pubkey).sort()).toEqual(["en_author", "friend"]);
  });

  it("flaggedPubkeys hides flagged unfollowed authors but not follows", () => {
    const flagged = ev({ pubkey: "bad" });
    const flaggedButFollowed = ev({ pubkey: "badfriend" });
    const clean = ev({ pubkey: "good" });
    const out = filterSpamEvents([flagged, flaggedButFollowed, clean], {
      follows: new Set(["badfriend"]),
      flaggedPubkeys: new Set(["bad", "badfriend"]),
    });
    expect(out.map((e) => e.pubkey).sort()).toEqual(["badfriend", "good"]);
  });

  it("no options set = passes clean Latin notes through", () => {
    const events = [ev({ content: "a normal english note here" })];
    expect(filterSpamEvents(events)).toHaveLength(1);
  });
});

describe("filterSpamEvents — hideNoProfile fails closed on unknown profiles", () => {
  // The first-paint contract for the global/discover feed: an author whose
  // profile has NOT been fetched yet (getter returns null) is not renderable
  // yet and must be HIDDEN, not passed through. Passing unknowns painted
  // raw-npub bot spam on load that visibly vanished once profiles arrived.
  const profiles: Record<string, any> = {
    named: { name: "Alice" },
    displayNamed: { display_name: "Bob" },
    nameless: { about: "no name set" },
  };
  const getter = (pk: string) => profiles[pk] ?? null;

  it("drops unfollowed authors whose profile is not fetched yet (getter → null)", () => {
    const unknown = ev({ pubkey: "spambot" });
    const known = ev({ pubkey: "named" });
    const out = filterSpamEvents([unknown, known], {
      hideNoProfile: true,
      profileGetter: getter,
    });
    expect(out.map((e) => e.pubkey)).toEqual(["named"]);
  });

  it("still drops authors with a profile but no name", () => {
    const noName = ev({ pubkey: "nameless" });
    const named = ev({ pubkey: "displayNamed" });
    const out = filterSpamEvents([noName, named], {
      hideNoProfile: true,
      profileGetter: getter,
    });
    expect(out.map((e) => e.pubkey)).toEqual(["displayNamed"]);
  });

  it("followed authors always pass, even with an unknown profile", () => {
    const followedUnknown = ev({ pubkey: "friend_no_profile_yet" });
    const strangerUnknown = ev({ pubkey: "stranger_no_profile_yet" });
    const out = filterSpamEvents([followedUnknown, strangerUnknown], {
      follows: new Set(["friend_no_profile_yet"]),
      hideNoProfile: true,
      profileGetter: getter,
    });
    expect(out.map((e) => e.pubkey)).toEqual(["friend_no_profile_yet"]);
  });

  it("hideNoProfile without a profileGetter passes everything (cannot judge)", () => {
    const unknown = ev({ pubkey: "whoever" });
    const out = filterSpamEvents([unknown], { hideNoProfile: true });
    expect(out).toHaveLength(1);
  });

  it("hideNoProfile off leaves unknown-profile authors visible (non-global feeds)", () => {
    const unknown = ev({ pubkey: "spambot" });
    const out = filterSpamEvents([unknown], { profileGetter: getter });
    expect(out).toHaveLength(1);
  });
});

describe("filterSpamEvents — three-state profile gate (profileSettledGetter)", () => {
  // "No profile YET" (fetch in flight → grace/hold) vs "no profile, PERIOD"
  // (fetch settled empty → resolved spam → drop). Both are held out of the
  // visible feed, but a graced author is re-admitted by the filter re-run the
  // moment their kind-0 lands, while a settled-unnamed one never is.
  const profiles: Record<string, any> = { named: { name: "Alice" } };
  const getter = (pk: string) => profiles[pk] ?? null;

  it("classifyProfileResolution: named / unnamed / settled-empty / in-flight", () => {
    const settled = (pk: string) => pk === "settled_no_profile";
    expect(classifyProfileResolution("named", getter, settled)).toBe("named");
    expect(classifyProfileResolution("settled_no_profile", getter, settled)).toBe("unnamed");
    expect(classifyProfileResolution("still_loading", getter, settled)).toBe("unknown");
    // A kind-0 with an empty name is resolved-unnamed regardless of settling.
    const emptyNameGetter = (_pk: string) => ({ about: "no name" });
    expect(classifyProfileResolution("x", emptyNameGetter, () => false)).toBe("unnamed");
    // No getter at all → fail open ("named"), legacy no-op behavior.
    expect(classifyProfileResolution("x", undefined, settled)).toBe("named");
  });

  it("holds in-flight strangers (grace) AND drops settled profile-less ones", () => {
    const loading = ev({ pubkey: "still_loading" });
    const settledEmpty = ev({ pubkey: "settled_no_profile" });
    const named = ev({ pubkey: "named" });
    const out = filterSpamEvents([loading, settledEmpty, named], {
      hideNoProfile: true,
      profileGetter: getter,
      profileSettledGetter: (pk) => pk === "settled_no_profile",
    });
    expect(out.map((e) => e.pubkey)).toEqual(["named"]);
  });

  it("re-admits a graced author once their kind-0 resolves with a name", () => {
    const author = ev({ pubkey: "late_bloomer" });
    const store: Record<string, any> = {};
    const liveGetter = (pk: string) => store[pk] ?? null;
    const opts: SpamFilterOptions = {
      hideNoProfile: true,
      profileGetter: liveGetter,
      profileSettledGetter: () => false,
    };
    expect(filterSpamEvents([author], opts)).toHaveLength(0); // grace: held
    store["late_bloomer"] = { name: "Slow Loader" };          // kind-0 lands
    expect(filterSpamEvents([author], opts)).toHaveLength(1); // re-admitted
  });

  it("followed authors pass even when settled with no profile", () => {
    const friend = ev({ pubkey: "friend_no_kind0" });
    const out = filterSpamEvents([friend], {
      follows: new Set(["friend_no_kind0"]),
      hideNoProfile: true,
      profileGetter: getter,
      profileSettledGetter: () => true,
    });
    expect(out).toHaveLength(1);
  });

  it("positive-WoT strangers pass even when settled with no profile", () => {
    const trusted = ev({ pubkey: "trusted_no_kind0" });
    const nobody = ev({ pubkey: "nobody_no_kind0" });
    const out = filterSpamEvents([trusted, nobody], {
      hideNoProfile: true,
      profileGetter: getter,
      profileSettledGetter: () => true,
      scoreGetter: (pk) => (pk === "trusted_no_kind0" ? 0.4 : undefined),
    });
    expect(out.map((e) => e.pubkey)).toEqual(["trusted_no_kind0"]);
  });
});

describe("normalizeForCrossDup", () => {
  it("lowercases, strips URLs / nostr: mentions / emoji, collapses whitespace", () => {
    const a = normalizeForCrossDup("CLAIM your Bitcoin NOW 🚀🚀 at https://primal.help/abc123 nostr:npub1xyz");
    const b = normalizeForCrossDup("claim your bitcoin   now at https://primal.help/OTHER999  nostr:npub1abc 🔥");
    expect(a).toBe("claim your bitcoin now at");
    expect(a).toBe(b);
  });

  it("returns empty string for empty/URL-only content", () => {
    expect(normalizeForCrossDup("")).toBe("");
    expect(normalizeForCrossDup("https://x.com/a https://y.com/b")).toBe("");
  });
});

describe("cross-author duplicate suppression (spam-wave signature)", () => {
  const SCAM = "Your wallet needs verification, claim support at https://primal.help/claim now";

  it("drops ALL copies when >= 3 distinct unfollowed authors share a normalized body", () => {
    const wave = [
      ev({ pubkey: "wave_a", content: SCAM }),
      ev({ pubkey: "wave_b", content: SCAM.toUpperCase() }),
      ev({ pubkey: "wave_c", content: `${SCAM} 🚀` }),
      ev({ pubkey: "bystander", content: "an original note about gardening today" }),
    ];
    const out = filterSpamEvents(wave, { crossAuthorDedupe: true, allEvents: wave });
    expect(out.map((e) => e.pubkey)).toEqual(["bystander"]);
  });

  it("URL rotation per copy does not evade the match", () => {
    const wave = [
      ev({ pubkey: "rot_a", content: "Claim your free reward here right now https://primal.help/aaa" }),
      ev({ pubkey: "rot_b", content: "claim your FREE reward here right now https://primal.help/bbb" }),
      ev({ pubkey: "rot_c", content: "Claim your free reward here right now https://scam.example/ccc" }),
    ];
    const out = filterSpamEvents(wave, { crossAuthorDedupe: true, allEvents: wave });
    expect(out).toHaveLength(0);
  });

  it("only 2 distinct authors → kept (below the wave threshold)", () => {
    const pair = [
      ev({ pubkey: "dup_a", content: SCAM }),
      ev({ pubkey: "dup_b", content: SCAM }),
    ];
    const out = filterSpamEvents(pair, { crossAuthorDedupe: true, allEvents: pair });
    expect(out).toHaveLength(2);
  });

  it("short common phrases (gm etc.) are never wave-matched", () => {
    const greetings = [
      ev({ pubkey: "gm_a", content: "gm" }),
      ev({ pubkey: "gm_b", content: "gm" }),
      ev({ pubkey: "gm_c", content: "gm" }),
      ev({ pubkey: "gm_d", content: "good morning nostr!" }),
      ev({ pubkey: "gm_e", content: "good morning nostr!" }),
      ev({ pubkey: "gm_f", content: "good morning nostr!" }),
    ];
    const out = filterSpamEvents(greetings, { crossAuthorDedupe: true, allEvents: greetings });
    expect(out).toHaveLength(6);
  });

  it("kind-6/16 reposts of one note are NOT a wave (repost content is the same event)", () => {
    const repostJson = JSON.stringify({ id: "orig", pubkey: "op", kind: 1, content: "a genuinely popular note that many people repost", tags: [] });
    const reposts = [
      ev({ pubkey: "rp_a", kind: 6, content: repostJson }),
      ev({ pubkey: "rp_b", kind: 6, content: repostJson }),
      ev({ pubkey: "rp_c", kind: 6, content: repostJson }),
      ev({ pubkey: "rp_d", kind: 16, content: repostJson }),
    ];
    const out = filterSpamEvents(reposts, { crossAuthorDedupe: true, allEvents: reposts });
    expect(out).toHaveLength(4);
  });

  it("same author repeating themselves (a thread) is not a cross-author wave", () => {
    const thread = [
      ev({ pubkey: "thready", content: "part one of my long thread about relays" }),
      ev({ pubkey: "thready", content: "part one of my long thread about relays" }),
      ev({ pubkey: "thready", content: "part one of my long thread about relays" }),
    ];
    // allEvents (same-author rule) intentionally NOT passed — cross-author only.
    const out = filterSpamEvents(thread, { crossAuthorDedupe: true, allEvents: thread });
    expect(out).toHaveLength(3);
  });

  it("followed authors neither count toward the threshold nor get dropped", () => {
    const text = "we are all posting this exact same meme text today friends";
    const events = [
      ev({ pubkey: "friend1", content: text }),
      ev({ pubkey: "friend2", content: text }),
      ev({ pubkey: "stranger1", content: text }),
      ev({ pubkey: "stranger2", content: text }),
    ];
    // Only 2 unfollowed authors share the body → no wave, everyone stays.
    const out = filterSpamEvents(events, {
      crossAuthorDedupe: true,
      allEvents: events,
      follows: new Set(["friend1", "friend2"]),
    });
    expect(out).toHaveLength(4);
  });

  it("a followed author caught inside a real wave still passes", () => {
    const text = "breaking: identical viral copypasta being reshared verbatim everywhere";
    const events = [
      ev({ pubkey: "friend", content: text }),
      ev({ pubkey: "s1", content: text }),
      ev({ pubkey: "s2", content: text }),
      ev({ pubkey: "s3", content: text }),
    ];
    const out = filterSpamEvents(events, {
      crossAuthorDedupe: true,
      allEvents: events,
      follows: new Set(["friend"]),
    });
    expect(out.map((e) => e.pubkey)).toEqual(["friend"]);
  });

  it("option off (default) → wave passes untouched (Following feed contract)", () => {
    const wave = [
      ev({ pubkey: "off_a", content: SCAM }),
      ev({ pubkey: "off_b", content: SCAM }),
      ev({ pubkey: "off_c", content: SCAM }),
    ];
    const out = filterSpamEvents(wave, { allEvents: wave });
    expect(out).toHaveLength(3);
  });

  it("buildCrossAuthorWaveSet exposes the wave signatures for a buffer", () => {
    const text = "verify your account immediately or lose access to funds";
    const events = [
      ev({ pubkey: "w1", content: text }),
      ev({ pubkey: "w2", content: text }),
      ev({ pubkey: "w3", content: text }),
      ev({ pubkey: "solo", content: "an unrelated original post about my dog" }),
    ];
    const waves = buildCrossAuthorWaveSet(events);
    expect(waves.size).toBe(1);
    expect(waves.has(normalizeForCrossDup(text))).toBe(true);
  });
});

describe("new-account combo gate (no score AND <48h AND <20 followers)", () => {
  const NOW = 1_700_000_000;
  const HOUR = 3600;

  const gateOpts = (over: Partial<SpamFilterOptions> = {}) => ({
    newAccountComboGate: true,
    nowSeconds: NOW,
    ...over,
  });

  it("drops a fresh, unscored, followerless account (all three hold)", () => {
    const bot = ev({ pubkey: "combo_bot" });
    const out = filterSpamEvents([bot], gateOpts({
      scoreGetter: () => undefined,
      firstSeenGetter: () => NOW - 2 * HOUR,
      followerCountGetter: () => 0,
    }));
    expect(out).toHaveLength(0);
  });

  it("undefined follower count counts as LOW within the combo (the fail-open hole the wave exploited)", () => {
    const bot = ev({ pubkey: "combo_bot_nofollowers" });
    const out = filterSpamEvents([bot], gateOpts({
      scoreGetter: () => undefined,
      firstSeenGetter: () => NOW - 2 * HOUR,
      followerCountGetter: () => undefined,
    }));
    expect(out).toHaveLength(0);
  });

  it("a trust score breaks the gate", () => {
    const scored = ev({ pubkey: "combo_scored" });
    const out = filterSpamEvents([scored], gateOpts({
      scoreGetter: () => 0.3,
      firstSeenGetter: () => NOW - 2 * HOUR,
      followerCountGetter: () => 0,
    }));
    expect(out).toHaveLength(1);
  });

  it("a provisional-NEGATIVE score still counts as unscored", () => {
    const neg = ev({ pubkey: "combo_negative" });
    const out = filterSpamEvents([neg], gateOpts({
      scoreGetter: () => -0.1,
      firstSeenGetter: () => NOW - 2 * HOUR,
      followerCountGetter: () => 0,
    }));
    expect(out).toHaveLength(0);
  });

  it("48 hours breaks the gate: a 3-day-old unscored account passes", () => {
    const older = ev({ pubkey: "combo_3days" });
    const out = filterSpamEvents([older], gateOpts({
      scoreGetter: () => undefined,
      firstSeenGetter: () => NOW - 72 * HOUR,
      followerCountGetter: () => 0,
    }));
    expect(out).toHaveLength(1);
  });

  it("unknown age (null first-seen) fails OPEN — an undatable account is not 'new'", () => {
    const unknownAge = ev({ pubkey: "combo_unknown_age" });
    const out = filterSpamEvents([unknownAge], gateOpts({
      scoreGetter: () => undefined,
      firstSeenGetter: () => null,
      followerCountGetter: () => 0,
    }));
    expect(out).toHaveLength(1);
  });

  it("20+ followers break the gate", () => {
    const popular = ev({ pubkey: "combo_popular" });
    const out = filterSpamEvents([popular], gateOpts({
      scoreGetter: () => undefined,
      firstSeenGetter: () => NOW - 2 * HOUR,
      followerCountGetter: () => 25,
    }));
    expect(out).toHaveLength(1);
  });

  it("one follow breaks the gate: a genuine new user the user follows passes", () => {
    const newFriend = ev({ pubkey: "combo_new_friend", content: "hello world, my first original note!" });
    const out = filterSpamEvents([newFriend], gateOpts({
      follows: new Set(["combo_new_friend"]),
      scoreGetter: () => undefined,
      firstSeenGetter: () => NOW - 1 * HOUR,
      followerCountGetter: () => 0,
    }));
    expect(out).toHaveLength(1);
  });

  it("no scoreGetter at all (WoT map unavailable) = unscored — the gate still works", () => {
    const bot = ev({ pubkey: "combo_no_wot" });
    const out = filterSpamEvents([bot], gateOpts({
      firstSeenGetter: () => NOW - 2 * HOUR,
      followerCountGetter: () => 0,
    }));
    expect(out).toHaveLength(0);
  });

  it("gate off (default) → fresh unscored accounts pass (Following feed contract)", () => {
    const bot = ev({ pubkey: "combo_gate_off" });
    const out = filterSpamEvents([bot], {
      nowSeconds: NOW,
      scoreGetter: () => undefined,
      firstSeenGetter: () => NOW - 2 * HOUR,
      followerCountGetter: () => 0,
    });
    expect(out).toHaveLength(1);
  });

  it("standalone minFollowers keeps failing open on undefined counts (unchanged behavior)", () => {
    const unknownCount = ev({ pubkey: "minf_unknown" });
    const out = filterSpamEvents([unknownCount], {
      minFollowers: 20,
      followerCountGetter: () => undefined,
    });
    expect(out).toHaveLength(1);
  });
});

describe("new-account combo gate — broadened-pool seam (engagementScoreGetter)", () => {
  const NOW = 1_700_000_000;
  const HOUR = 3600;

  const seamOpts = (over: Partial<SpamFilterOptions> = {}): SpamFilterOptions => ({
    newAccountComboGate: true,
    nowSeconds: NOW,
    scoreGetter: () => undefined,
    followerCountGetter: () => undefined,
    firstSeenGetter: () => null, // UNDATABLE — the seam the broadened pool exposes
    engagementScoreGetter: () => 0,
    ...over,
  });

  it("with an engagement getter, an undatable zero-signal stranger is GATED (tightened seam)", () => {
    const ghost = ev({ pubkey: "seam_ghost" });
    const out = filterSpamEvents([ghost], seamOpts());
    expect(out).toHaveLength(0);
  });

  it("real engagement fails the seam open even when undatable", () => {
    const engaged = ev({ pubkey: "seam_engaged" });
    const out = filterSpamEvents([engaged], seamOpts({ engagementScoreGetter: () => 12 }));
    expect(out).toHaveLength(1);
  });

  it("a trust score fails the seam open", () => {
    const scored = ev({ pubkey: "seam_scored" });
    const out = filterSpamEvents([scored], seamOpts({ scoreGetter: () => 0.2 }));
    expect(out).toHaveLength(1);
  });

  it("established age fails the seam open", () => {
    const older = ev({ pubkey: "seam_old" });
    const out = filterSpamEvents([older], seamOpts({ firstSeenGetter: () => NOW - 72 * HOUR }));
    expect(out).toHaveLength(1);
  });

  it("enough followers fail the seam open", () => {
    const popular = ev({ pubkey: "seam_popular" });
    const out = filterSpamEvents([popular], seamOpts({ followerCountGetter: () => 40 }));
    expect(out).toHaveLength(1);
  });

  it("WITHOUT an engagement getter, undatable accounts still fail OPEN (legacy behavior preserved)", () => {
    const ghost = ev({ pubkey: "seam_legacy_ghost" });
    const out = filterSpamEvents([ghost], {
      newAccountComboGate: true,
      nowSeconds: NOW,
      scoreGetter: () => undefined,
      followerCountGetter: () => undefined,
      firstSeenGetter: () => null,
    });
    expect(out).toHaveLength(1);
  });

  it("followed authors are exempt from the seam", () => {
    const friend = ev({ pubkey: "seam_friend" });
    const out = filterSpamEvents([friend], seamOpts({ follows: new Set(["seam_friend"]) }));
    expect(out).toHaveLength(1);
  });
});

describe("the wave, end to end (For You floor options together)", () => {
  const NOW = 1_800_000_000;
  const HOUR = 3600;
  const SCAM = "Hello dear friend, your account needs urgent verification, get help at https://primal.help/support";

  // Impersonation profiles are COMPLETE (name + about + picture) — the wave's
  // whole trick — so hideNoProfile alone cannot stop them.
  const profiles: Record<string, any> = {};
  const wavePubkeys = ["wave1", "wave2", "wave3", "wave4", "wave5", "wave6"];
  wavePubkeys.forEach((pk, i) => {
    profiles[pk] = { name: `Primal Support ${i}`, about: "Official support account", picture: "https://x/y.png" };
  });
  profiles["genuine_new"] = { name: "Carol", about: "just joined!" };
  profiles["veteran"] = { name: "Dave", about: "long-time poster" };

  const forYouOptions = (events: Event[], follows: Set<string>) => ({
    follows,
    allEvents: events,
    hideNoProfile: true,
    profileGetter: (pk: string) => profiles[pk] ?? null,
    minFollowers: 20,
    followerCountGetter: (pk: string) => (pk === "veteran" ? 500 : undefined),
    crossAuthorDedupe: true,
    newAccountComboGate: true,
    scoreGetter: (pk: string) => (pk === "veteran" ? 0.4 : undefined),
    firstSeenGetter: (pk: string) =>
      pk === "veteran" ? NOW - 900 * HOUR : pk === "old_unscored" ? NOW - 72 * HOUR : NOW - 3 * HOUR,
    nowSeconds: NOW,
  });

  it("6 fresh impersonation pubkeys posting near-identical scam text all drop; real users survive", () => {
    const events = [
      ...wavePubkeys.map((pk, i) => ev({ pubkey: pk, content: `${SCAM.replace("/support", `/s${i}`)} 🚀` })),
      ev({ pubkey: "genuine_new", content: "my very first note — excited to be on nostr, here is my intro" }),
      ev({ pubkey: "veteran", content: "another tuesday, another relay migration post" }),
    ];
    // The user follows the genuine newcomer (one follow breaks the gate).
    const out = filterSpamEvents(events, forYouOptions(events, new Set(["genuine_new"])));
    expect(out.map((e) => e.pubkey).sort()).toEqual(["genuine_new", "veteran"]);
  });

  it("even a wave of only 2 copies (below dedupe threshold) still dies on the combo gate", () => {
    const events = [
      ev({ pubkey: "wave1", content: SCAM }),
      ev({ pubkey: "wave2", content: `${SCAM} extra words to differ` }),
      ev({ pubkey: "veteran", content: "an ordinary post" }),
    ];
    const out = filterSpamEvents(events, forYouOptions(events, new Set()));
    expect(out.map((e) => e.pubkey)).toEqual(["veteran"]);
  });
});

describe("mute + report enforcement (the never-see-again contract)", () => {
  it("drops events from a muted pubkey and restores them on unmute", () => {
    const spam = ev({ pubkey: "f".repeat(64), content: "spam across hashtags" });
    mutePubkey(spam.pubkey);
    expect(filterSpamEvents([spam])).toHaveLength(0);
    unmutePubkey(spam.pubkey);
    expect(filterSpamEvents([spam])).toHaveLength(1);
  });

  it("drops BOTH the reported event and everything else by its author", () => {
    const author = "e".repeat(64);
    const reported = ev({ pubkey: author, content: "reported post" });
    const other = ev({ pubkey: author, content: "different post, same author" });
    addReportedItem({ eventId: reported.id, pubkey: author, reason: "spam", reportedAt: Date.now() });
    expect(filterSpamEvents([reported, other])).toHaveLength(0);
    removeReportedItem(reported.id);
  });

  it("notifies mute listeners when a report is added — the reactivity every feed depends on", () => {
    let fired = 0;
    const unsub = onMuteChange(() => { fired++; });
    const target = ev({ pubkey: "d".repeat(64), content: "x" });
    addReportedItem({ eventId: target.id, pubkey: target.pubkey, reason: "spam", reportedAt: Date.now() });
    expect(fired).toBeGreaterThan(0);
    removeReportedItem(target.id);
    unsub();
  });
});

describe("isMachineReadableContent — the payload that reached Trending", () => {
  it("catches the observed zone_presence heartbeat verbatim", () => {
    // Owner screenshot, 2026-08-12: a profileless service account published
    // this every 2 minutes (ttl 120), and the Trending supplement's
    // newest-first pick gave it a standing top-of-feed slot because no gate
    // ran on that lane. Pinned verbatim so the detector can never regress
    // below the payload that actually shipped to a phone.
    const payload = JSON.stringify({
      type: "zone_presence",
      zone: "7gS9HiiyJAlzX6DpcYoq",
      devicePk: "0f92c4a4aab613ff051f2a6e9cde7d0d131faa576a11ffe175ab82b4715c501b",
      swarm: "70.162.9.155:4040",
      role: "gateway",
      relays: ["10.0.30.44:7447"],
      hostPlatform: "linux",
      serviceVersion: "0.1.3",
      metrics: { clients: 0, cpuPct: 47.1, memPct: 11.6 },
      ts: 1785713170000,
      ttl: 120,
    });
    expect(isMachineReadableContent(payload)).toBe(true);
  });

  it("does not flag a human post that merely mentions JSON", () => {
    expect(isMachineReadableContent('the config is just {"debug": true} and it works, ship it')).toBe(false);
  });
});
