/**
 * "People to follow" — the quiet strip under the Discover bento grid
 * (DISCOVER_BENTO_PLAN.md round 2, decisions 15–16).
 *
 * SOURCING: friends-of-follows first (people followed by ≥2 of YOUR follows,
 * ranked by that count — the signal no global trending list can fake),
 * trending as the fallback for sparse accounts and guests. The pure ranking
 * with all its safety rules lives in lib/discover-people.ts and is tested
 * there; this component only fetches pools and renders survivors.
 *
 * THE FLOOR RUNS BEFORE RENDER — literally. A recommendation card is the app
 * VOUCHING for an account to a newcomer, so: the spam list is fetched by this
 * component (nothing else on /discover loads it) and re-ranks on arrival; a
 * WoT-on viewer's strip HOLDS until flaggedPubkeys exists rather than
 * rendering into the load window and filtering after; guests and WoT-off
 * viewers are floored by the spam/mute lists, which are the shield they have.
 *
 * RENDERS 4–6 CARDS OR NOTHING (the Circle precedent, #489): a strip of two
 * half-resolved profiles reads as a broken feature, and this is additive
 * content, not a door — absence claims nothing, so no reach states here.
 *
 * FOLLOW goes through useFollowAction exclusively — the sanctioned guarded
 * kind-3 path (wipe footgun, 51023d6). No publish logic lives here.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { Check, Plus, UserPlus } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { useFollowsOfFollows } from "@/hooks/use-follows-of-follows";
import { useFollowAction } from "@/hooks/use-follow-action";
import { rankPeopleToFollow, type PersonCandidate } from "@/lib/discover-people";
import { fetchTrendingAuthors } from "@/lib/discover-people-data";
import { isSpamPubkey, isMutedPubkey, fetchSpamList, onSpamListChange, onMuteChange } from "@/lib/spam-filter";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { KIND_METADATA, getAvatarUrl } from "@/lib/nostr-helpers";
import { FOCUS_RING } from "@/lib/a11y";

// Up to 8 so a wide desktop strip fills evenly (a 6-card row left a gap
// on wide screens); mobile just scrolls the extras.
const SHOW_LIMIT = 8;
/** Below this many resolved cards the strip renders nothing (Circle rule). */
const MIN_TO_SHOW = 4;
/** Rank more than we show — some candidates never resolve a usable profile. */
const RANK_POOL = 18;

/** A card needs a real face and a real name — never an npub-smudge tile. */
function usableProfile(ev: Event | null): { name: string; avatar: string } | null {
  if (!ev) return null;
  try {
    const content = JSON.parse(ev.content);
    const name = (content.display_name || content.name || "").trim();
    const avatar = getAvatarUrl(ev);
    if (!name || !avatar || !/^https?:\/\//.test(avatar)) return null;
    return { name, avatar };
  } catch {
    return null;
  }
}

export function PeopleToFollowStrip({ className = "" }: { className?: string }) {
  const [, setLocation] = useLocation();
  const { pubkey, follows } = useNostrAuth();
  const { flaggedPubkeys, wotEnabled } = useGrapeRankScores();
  const { fofCounts } = useFollowsOfFollows(pubkey ? follows : undefined);
  const { follow, pending, isFollowing, canFollow } = useFollowAction();

  const [trending, setTrending] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchTrendingAuthors(RANK_POOL * 2).then((pks) => { if (!cancelled) setTrending(pks); });
    return () => { cancelled = true; };
  }, []);

  // The spam/mute floor is MODULE state that nothing on /discover used to
  // load: fetchSpamList() was only ever fired by useSpamFilter, which mounts
  // on Home/Search/feeds — so on a cold landing here isSpamPubkey checked a
  // permanently empty set and the "floor" was inert exactly for the arrival
  // path a shared link produces. Load it ourselves, and bump a version when
  // either list changes so the rank memo re-runs — a floor that cannot fire
  // after the fact is filter-after-render with extra steps.
  const [floorVersion, setFloorVersion] = useState(0);
  useEffect(() => {
    fetchSpamList().catch(() => {});
    const bump = () => setFloorVersion((v) => v + 1);
    const offSpam = onSpamListChange(bump);
    const offMute = onMuteChange(bump);
    return () => { offSpam?.(); offMute?.(); };
  }, []);

  const followSet = useMemo(() => new Set(follows ?? []), [follows]);

  const ranked: PersonCandidate[] = useMemo(() => {
    // Spam/muted are function-checks, not sets — fold them into the exclusion
    // by pre-filtering both pools so the ranker's flagged-set contract stays
    // one set. Cheap: the pools are already bounded.
    const clean = (pk: string) => !isSpamPubkey(pk) && !isMutedPubkey(pk);
    const counts = new Map<string, number>();
    fofCounts.forEach((n, pk) => { if (clean(pk)) counts.set(pk, n); });
    return rankPeopleToFollow({
      viewer: pubkey,
      followSet,
      networkCounts: counts,
      trending: trending.filter(clean),
      flagged: flaggedPubkeys ?? new Set(),
      limit: RANK_POOL,
    });
    // floorVersion re-runs the spam/mute checks when those lists ARRIVE.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, followSet, fofCounts, trending, flaggedPubkeys, floorVersion]);

  // Store-poll until profiles resolve (the SuggestedFollowsStrip /
  // IdentityCircleCard pattern — there is no awaitable "profiles ready").
  const [profiles, setProfiles] = useState<Map<string, Event | null>>(new Map());
  const rankedKey = ranked.map((c) => c.pubkey).join(",");
  useEffect(() => {
    if (ranked.length === 0) return;
    try { fetchProfilesCached(ranked.map((c) => c.pubkey)); } catch { /* store-poll below */ }
    const tick = () => {
      setProfiles((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const c of ranked) {
          const ev = (eventStore.getReplaceable?.(KIND_METADATA, c.pubkey) ?? null) as Event | null;
          if (ev && next.get(c.pubkey) !== ev) { next.set(c.pubkey, ev); changed = true; }
          else if (!next.has(c.pubkey)) { next.set(c.pubkey, null); changed = true; }
        }
        return changed ? next : prev;
      });
    };
    tick();
    const i = setInterval(tick, 1000);
    // Stop polling once everything visible has resolved or 15s passed — a
    // 1s interval forever on a landing page is its own perf bug.
    const stop = setTimeout(() => clearInterval(i), 15_000);
    return () => { clearInterval(i); clearTimeout(stop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedKey]);

  // FREEZE ON FIRST FILL. Without this the strip was unstable in two ways the
  // review caught: (1) tapping Follow removed the card in the same render —
  // the "Followed ✓" state was unreachable dead code, and with exactly 4 cards
  // the whole strip vanished under the user's finger mid-publish; (2) fof
  // contact lists stream in for ~20s after mount, so network candidates kept
  // inserting at the front of a strip the user was already reading. Once the
  // first full set renders, its membership is pinned for the mount.
  //
  // SAFETY STILL REMOVES. The floor arriving late (flagged batch, spam list)
  // must be able to pull a card — safety outranks stability — which is why the
  // frozen list is re-filtered against the CURRENT exclusions on every render,
  // but never against isFollowing/followSet: following someone is confirmation,
  // not grounds for eviction.
  const frozenRef = useRef<Array<PersonCandidate & { name: string; avatar: string }> | null>(null);
  const fresh = useMemo(() => {
    const out: Array<PersonCandidate & { name: string; avatar: string }> = [];
    for (const c of ranked) {
      const p = usableProfile(profiles.get(c.pubkey) ?? null);
      if (p) out.push({ ...c, ...p });
      if (out.length >= SHOW_LIMIT) break;
    }
    return out;
  }, [ranked, profiles]);
  // ── The flagged floor must run BEFORE render for a shielded viewer ──
  // flaggedPubkeys is a network round trip that starts null (and re-nulls on a
  // failed fetch). Rendering trending cards inside that window and filtering
  // when the set lands is filter-after-render — the exact thing the plan
  // forbids — so a WoT-on viewer's strip HOLDS until the set exists, and the
  // hold sits ABOVE the latch so the pinned set can never be captured from
  // unfloored candidates. Guests and WoT-off viewers have no shield to wait
  // for.
  const holdForFloor = !!pubkey && wotEnabled && !flaggedPubkeys;

  // LATCH GRACE. The pin exists to stop churn, but pinning on FIRST fill let
  // trending (instant, session-cached) win the race against friends-of-follows
  // (kind-3s stream in for seconds) on every warm mount — quietly demoting the
  // headline sourcing decision to a fallback. So for a viewer whose network
  // POOL is expected, the latch waits for a network-sourced card or the grace
  // deadline, whichever comes first: one pop-in, no streaming churn, and the
  // un-gameable signal actually gets to rank first.
  const expectNetwork = !!pubkey && (follows?.length ?? 0) > 0;
  const [latchGraceOver, setLatchGraceOver] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLatchGraceOver(true), 8_000);
    return () => clearTimeout(t);
  }, []);
  const freshHasNetwork = fresh.some((c) => c.source === "network");
  const readyToLatch = !holdForFloor && (freshHasNetwork || !expectNetwork || latchGraceOver);
  if (readyToLatch && !frozenRef.current && fresh.length >= MIN_TO_SHOW) frozenRef.current = fresh;

  const stillSafe = (pk: string) =>
    !(flaggedPubkeys?.has(pk)) && !isSpamPubkey(pk) && !isMutedPubkey(pk);
  const cards = (frozenRef.current ?? []).filter((c) => stillSafe(c.pubkey));

  if (holdForFloor || cards.length === 0) return null;

  const openProfile = (pk: string) => {
    try { setLocation(`/profile/${nip19.npubEncode(pk)}`); } catch { /* bad pk — no-op */ }
  };

  return (
    <div className={`space-y-2 ${className}`} data-testid="people-to-follow-strip">
      <div className="flex items-center gap-2 px-1">
        <UserPlus className="w-4 h-4 text-brand/70" />
        <span className="text-sm font-semibold">People to follow</span>
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {cards.map((c) => (
          <div
            key={c.pubkey}
            className="glass-card shrink-0 w-[130px] rounded-xl border p-3 flex flex-col items-center gap-1.5 text-center"
            data-testid={`person-card-${c.pubkey.slice(0, 8)}`}
          >
            <button
              type="button"
              onClick={() => openProfile(c.pubkey)}
              className={`flex flex-col items-center gap-1.5 min-w-0 w-full cursor-pointer rounded-lg ${FOCUS_RING}`}
              aria-label={`Open ${c.name}'s profile`}
            >
              <Avatar className="w-12 h-12 border border-border/40">
                <AvatarImage src={c.avatar} alt="" />
                <AvatarFallback className="text-xs bg-muted/50">{c.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="text-xs font-medium truncate w-full">{c.name}</span>
              {/* The WHY, because an unexplained recommendation is an ad. */}
              <span className="text-[10px] text-muted-foreground/70 truncate w-full">
                {c.source === "network" ? `Followed by ${c.followedByCount} you follow` : "Trending now"}
              </span>
            </button>
            {canFollow && (
              <Button
                size="sm"
                variant={isFollowing(c.pubkey) ? "secondary" : "outline"}
                disabled={pending.has(c.pubkey) || isFollowing(c.pubkey)}
                className="h-7 w-full text-[11px] gap-1 touch-target"
                onClick={() => follow(c.pubkey)}
                data-testid={`button-strip-follow-${c.pubkey.slice(0, 8)}`}
              >
                {pending.has(c.pubkey) ? "…" : isFollowing(c.pubkey)
                  ? <><Check className="w-3 h-3" />Followed</>
                  : <><Plus className="w-3 h-3" />Follow</>}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
