import { BtcZapIcon } from "@/components/icons/BtcZapIcon";
import { PersonAvatar } from "@/components/PersonAvatar";
import { usePetnamesVersion } from "@/lib/petnames";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { Link } from "wouter";
import { use$ } from "applesauce-react/hooks";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { ActivityIndicator } from "@/components/ActivityIndicator";
import { Nip05Badge } from "@/components/Nip05Badge";
import { PostBadgeIcons } from "@/components/BadgeDisplay";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Copy, Check, ShieldCheck, Zap, AlertTriangle } from "lucide-react";
import {
  getDisplayName,
  getProfileContent,
  KIND_METADATA,
} from "@/lib/nostr-helpers";
import { useAttestations, isActiveAttestation, getAttestationStatusLabel, type Attestation } from "@/hooks/use-attestations";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { getReplyTier } from "@/lib/graperank";
import type { SignalTier } from "@/lib/graperank";
import { getTrustPhrase } from "@/lib/trust-words";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { TIER_GLYPH, TrustTierGlyph } from "@/components/nostr-post/trust-tier-glyph";
import { RelayOutpostIcon } from "@/components/RelayOutpostLoader";
import nostrOstrichGif from "@assets/219719339-5eff628c-3470-4cc3-81eb-404f8902de9f_1771392554698.gif";
import { ZapDialog } from "@/components/lazy-dialogs";

export function useLazyScoreRequest(pubkey: string, tier: SignalTier) {
  const { requestScore } = useGrapeRankScores();
  useEffect(() => {
    if (pubkey && tier === "none") {
      requestScore(pubkey);
    }
  }, [pubkey, tier, requestScore]);
}

export function VerifiedBadgeIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M8.38 12.0001L10.79 14.4201L15.62 9.58008" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.75 2.45031C11.44 1.86031 12.57 1.86031 13.27 2.45031L14.85 3.81031C15.15 4.07031 15.71 4.28031 16.11 4.28031H17.81C18.87 4.28031 19.74 5.15031 19.74 6.21031V7.91031C19.74 8.30031 19.95 8.87031 20.21 9.17031L21.57 10.7503C22.16 11.4403 22.16 12.5703 21.57 13.2703L20.21 14.8503C19.95 15.1503 19.74 15.7103 19.74 16.1103V17.8103C19.74 18.8703 18.87 19.7403 17.81 19.7403H16.11C15.72 19.7403 15.15 19.9503 14.85 20.2103L13.27 21.5703C12.58 22.1603 11.45 22.1603 10.75 21.5703L9.17 20.2103C8.87 19.9503 8.31 19.7403 7.91 19.7403H6.18C5.12 19.7403 4.25 18.8703 4.25 17.8103V16.1003C4.25 15.7103 4.04 15.1503 3.79 14.8503L2.44 13.2603C1.86 12.5703 1.86 11.4503 2.44 10.7603L3.79 9.17031C4.04 8.87031 4.25 8.31031 4.25 7.92031V6.20031C4.25 5.14031 5.12 4.27031 6.18 4.27031H7.91C8.3 4.27031 8.87 4.06031 9.17 3.80031L10.75 2.45031Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function useHoverPopover(openDelay = 300, closeDelay = 150) {
  const [open, setOpen] = useState(false);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (enterTimer.current) { clearTimeout(enterTimer.current); enterTimer.current = null; }
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
  }, []);

  const handleEnter = useCallback(() => {
    clearTimers();
    enterTimer.current = setTimeout(() => setOpen(true), openDelay);
  }, [openDelay, clearTimers]);

  const handleLeave = useCallback(() => {
    clearTimers();
    leaveTimer.current = setTimeout(() => setOpen(false), closeDelay);
  }, [closeDelay, clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  return { open, setOpen, handleEnter, handleLeave };
}

export function TrustTierDot({ pubkey }: { pubkey: string }) {
  const { pubkey: myPubkey } = useNostrAuth();
  const isSelf = !!myPubkey && myPubkey === pubkey;
  const { getAuthorTier, isAuthorFlagged, scores, wotEnabled, wotReady } = useGrapeRankScores();
  const tier = isSelf ? "strong" : getAuthorTier(pubkey);
  useLazyScoreRequest(isSelf ? "" : pubkey, tier);
  const hover = useHoverPopover();

  // Web of Trust off → no trust indicator anywhere, including on your own posts.
  // Same while this observer's FIRST calculation is still running (wotReady):
  // any dot shown before scores exist would be a false signal.
  if (!wotEnabled || !wotReady) return null;

  if (isSelf) {
    return (
      <span className="inline-flex items-center justify-center shrink-0">
        <RelayOutpostIcon className="w-4 h-4 text-brand/70" />
      </span>
    );
  }

  if (!scores) return null;
  const scoreLookedUp = scores.has(pubkey);
  const flagged = isAuthorFlagged(pubkey);

  if (!scoreLookedUp && !flagged) return null;

  // One pop-up for every tier: a phrase about the reader's network and what
  // it means, never a number (owner, 2026-10-03: "Highly Trusted 100%" read
  // as a verdict on a person). The percentage stays in the profile's trust panel.
  const shown: SignalTier = flagged ? "flagged" : tier;
  const phrase = shown === "none" ? "Not in your network yet" : getTrustPhrase(shown);
  const glyphSize = shown === "flagged" ? "w-4 h-4" : shown === "none" ? "w-2.5 h-2.5" : "w-2 h-2";
  return (
    <Popover open={hover.open} onOpenChange={hover.setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center justify-center shrink-0 cursor-pointer"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={hover.handleEnter}
          onMouseLeave={hover.handleLeave}
          aria-label={`Trust: ${phrase}`}
        >
          <TrustTierGlyph tier={shown} size={glyphSize} decorative />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-60 p-3 rounded-[16px] border-border/60"
        side="bottom"
        align="start"
        sideOffset={6}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={hover.handleEnter}
        onMouseLeave={hover.handleLeave}
      >
        <div className="flex items-center gap-1.5">
          <TrustTierGlyph tier={shown} size="w-3 h-3" decorative />
          <span className={`text-[13px] font-semibold ${shown === "flagged" ? "text-danger" : "text-foreground"}`}>{phrase}</span>
        </div>
        <p className="text-[13px] text-muted-foreground leading-snug mt-1">{TRUST_MEANING[shown]}</p>
        <p className="text-[12px] text-muted-foreground mt-1.5">From your Web of Trust</p>
      </PopoverContent>
    </Popover>
  );
}

/** What each phrase means, in the reader's terms. */
const TRUST_MEANING: Record<SignalTier, string> = {
  strong: "People you trust follow them, directly or through people they trust.",
  moderate: "People you trust know them.",
  low: "They have a little presence in your network so far.",
  weak: "Hardly anyone in your network follows them yet.",
  flagged: "Two or more people you trust have reported them.",
  none: "Nobody in your network follows them yet.",
};

export function ThreadTrustBar({ replies, excludedTiers, onFilterChange }: {
  replies: Event[];
  excludedTiers: Set<string>;
  onFilterChange: (tiers: Set<string>) => void;
}) {
  const { scores, flaggedPubkeys, getAuthorInfluence, requestScoresBulk, wotEnabled } = useGrapeRankScores();

  const uniquePubkeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of replies) set.add(r.pubkey);
    return Array.from(set);
  }, [replies]);

  useEffect(() => {
    // A null store must not block hydration — requestScoresBulk can now create
    // the map itself (e.g. when the connection-scores fetch failed or is slow).
    const missing = scores ? uniquePubkeys.filter(pk => !scores.has(pk)) : uniquePubkeys;
    if (missing.length > 0) requestScoresBulk(missing);
  }, [uniquePubkeys, scores, requestScoresBulk]);

  const analysis = useMemo(() => {
    if (!scores || uniquePubkeys.length === 0) return null;
    let strong = 0, moderate = 0, low = 0, weak = 0, unverified = 0, unknown = 0, flagged = 0;
    const allScores: number[] = [];
    let scoredCount = 0;
    let totalWeight = 0;

    for (const pk of uniquePubkeys) {
      const isFlagged = flaggedPubkeys?.has(pk) ?? false;
      const influence = getAuthorInfluence(pk);
      // Distribution stats are over SCORED accounts only — accounts with no data
      // (unknown) don't drag the median/avg toward zero just for being unindexed.
      if (influence !== null) { scoredCount++; totalWeight += influence; allScores.push(influence); }
      const dt = getReplyTier(influence, isFlagged);
      if (dt === "flagged") flagged++;
      else if (dt === "strong") strong++;
      else if (dt === "moderate") moderate++;
      else if (dt === "low") low++;
      else if (dt === "weak") weak++;
      else if (dt === "unverified") unverified++;
      else unknown++; // no trust data — benefit of the doubt
    }

    const total = uniquePubkeys.length;
    const avgInfluence = scoredCount > 0 ? totalWeight / scoredCount : 0;

    const sorted = [...allScores].sort((a, b) => b - a);
    const topN = Math.max(1, Math.min(3, Math.ceil(total * 0.1)));
    const topWeight = sorted.slice(0, topN).reduce((s, v) => s + v, 0);
    const concentration = totalWeight > 0 ? topWeight / totalWeight : 0;

    const medianIdx = Math.floor(sorted.length / 2);
    const median = sorted.length === 0
      ? 0
      : sorted.length % 2 === 0
        ? (sorted[medianIdx - 1] + sorted[medianIdx]) / 2
        : sorted[medianIdx];

    let warning: string | null = null;
    // "No trust signal" = genuinely low + no data + flagged. Distinct from the
    // flagged-specific and concentration warnings below.
    const noSignalRatio = (unverified + unknown + flagged) / total;
    if (flagged > 0 && flagged >= total * 0.2) {
      warning = `${flagged} ${flagged === 1 ? "person" : "people"} your network has concerns about ${flagged === 1 ? "is" : "are"} replying`;
    } else if (total >= 10 && scoredCount >= 3 && concentration > 0.85 && median < 0.02) {
      warning = "Lots of replies from accounts with few ties; the trust sits with a few of them";
    } else if (noSignalRatio > 0.6) {
      warning = `${Math.round(noSignalRatio * 100)}% of the people replying have few or no ties to your network`;
    } else if (total >= 5 && avgInfluence < 0.01 && scoredCount >= total * 0.5) {
      warning = "Most people replying are known to few in your network";
    }

    return {
      strong, moderate, low, weak, unverified, unknown, flagged, total,
      avgInfluence, median, concentration, topN, scoredCount, warning,
    };
  }, [uniquePubkeys, scores, flaggedPubkeys, getAuthorInfluence]);

  const toggleTier = useCallback((tierId: string) => {
    const next = new Set(excludedTiers);
    if (next.has(tierId)) next.delete(tierId);
    else next.add(tierId);
    onFilterChange(next);
  }, [excludedTiers, onFilterChange]);

  if (!wotEnabled || !analysis || analysis.total < 2) return null;

  const { strong, moderate, low, weak, unverified, unknown, flagged, total,
    avgInfluence, median, concentration, topN, scoredCount, warning } = analysis;

  // Colours from TIER_GLYPH, the one trust colour map, so this bar, its
  // legend and the dot beside each author agree; red is for concerns only.
  const segments = [
    { count: strong, bar: TIER_GLYPH.strong.className, glyph: "strong" as const, label: "Trusted", tierId: "strong" },
    { count: moderate, bar: TIER_GLYPH.moderate.className, glyph: "moderate" as const, label: "Known", tierId: "moderate" },
    { count: low, bar: TIER_GLYPH.low.className, glyph: "low" as const, label: "Some ties", tierId: "low" },
    { count: weak, bar: TIER_GLYPH.weak.className, glyph: "weak" as const, label: "Few ties", tierId: "weak" },
    // Genuinely scored low vs. simply no data — kept distinct so filtering out
    // low-trust accounts never silently buries content we just lack a score for.
    { count: unverified, bar: "bg-foreground/30", glyph: "none" as const, label: "Unverified", tierId: "unverified" },
    { count: unknown, bar: "bg-foreground/[0.12]", glyph: null, label: "No data", tierId: "unknown" },
    { count: flagged, bar: "bg-danger", glyph: "flagged" as const, label: "Concerns", tierId: "flagged" },
  ].filter(s => s.count > 0);

  const hasActiveFilter = excludedTiers.size > 0;

  const filteredCount = hasActiveFilter
    ? segments.reduce((sum, seg) => sum + (excludedTiers.has(seg.tierId) ? 0 : seg.count), 0)
    : total;

  // The spread in words; the raw figures stay in the tooltip.
  const level = avgInfluence >= 0.15 ? "Mostly people your network trusts" : avgInfluence >= 0.02 ? "Some people your network trusts" : avgInfluence > 0 ? "Few people your network trusts" : "No one your network knows yet";
  const spread = total < 4 ? null : concentration > 0.85 ? "the trust sits with a few accounts" : concentration > 0.6 ? "the trust is somewhat concentrated" : "the trust is spread widely";
  const figures = `Average ${avgInfluence.toFixed(4)} · median ${median.toFixed(4)}${total >= 4 ? ` · top ${topN} hold ${Math.round(concentration * 100)}%` : ""}`;

  return (
    <div className="px-4 py-3 border-b border-border/60 space-y-2" data-testid="thread-trust-bar">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full overflow-hidden flex gap-px bg-foreground/[0.06]" role="img" aria-label={segments.map((s) => `${s.label} ${s.count}`).join(", ")}>
          {segments.map((seg) => (
            <div
              key={seg.label}
              className={`h-full ${seg.bar} ${excludedTiers.has(seg.tierId) ? "opacity-20" : ""}`}
              style={{ width: `${(seg.count / total) * 100}%`, minWidth: "4px" }}
              title={`${seg.label}: ${seg.count}`}
            />
          ))}
        </div>
        <span className="text-[12px] text-muted-foreground shrink-0 tabular-nums">
          {hasActiveFilter ? `${filteredCount} of ${total}` : total} {total === 1 ? "person" : "people"} replied
        </span>
      </div>
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
        {segments.map((seg) => {
          const excluded = excludedTiers.has(seg.tierId);
          return (
            <button
              key={seg.label}
              type="button"
              aria-pressed={!excluded}
              title={excluded ? `Show ${seg.label}` : `Hide ${seg.label}`}
              onClick={() => toggleTier(seg.tierId)}
              className={`hit-area inline-flex items-center gap-1.5 text-[12px] rounded-full px-1.5 -mx-1.5 py-0.5 hover:bg-foreground/[0.05] transition-colors duration-150 cursor-pointer ${excluded ? "text-muted-foreground line-through decoration-1" : "text-foreground/80"}`}
            >
              {seg.glyph
                ? <TrustTierGlyph tier={seg.glyph} size={seg.glyph === "flagged" ? "w-3 h-3" : "w-2 h-2"} decorative className={excluded ? "opacity-40" : undefined} />
                : <span className={`w-2 h-2 rounded-full ${seg.bar} ${excluded ? "opacity-40" : ""}`} aria-hidden="true" />}
              {seg.label} <span className="tabular-nums">{seg.count}</span>
            </button>
          );
        })}
        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => onFilterChange(new Set())}
            className="hit-area text-[12px] font-medium text-brand hover:text-brand-strong transition-colors duration-150 cursor-pointer"
          >
            Show all
          </button>
        )}
      </div>
      {scoredCount > 0 && (
        <p className="text-[12px] text-muted-foreground" title={figures}>
          {level}{spread ? `; ${spread}` : ""}.
        </p>
      )}
      {warning && (
        <p className="flex items-start gap-1.5 text-[12px] font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          {warning}
        </p>
      )}
    </div>
  );
}

export function VouchedBySection({ pubkey }: { pubkey: string }) {
  const { pubkey: myPubkey } = useNostrAuth();
  const { scores, requestScore } = useGrapeRankScores();
  const { attestations, fetched, fetch: fetchAttestations } = useAttestations(pubkey);

  useEffect(() => {
    if (myPubkey && pubkey !== myPubkey) fetchAttestations();
  }, [myPubkey, pubkey, fetchAttestations]);

  useEffect(() => {
    if (!fetched || attestations.length === 0 || !scores || !requestScore) return;
    for (const att of attestations) {
      if (!scores.has(att.attesterPubkey)) requestScore(att.attesterPubkey);
    }
  }, [fetched, attestations, scores, requestScore]);

  const trustedVouchers = useMemo(() => {
    if (!fetched || attestations.length === 0 || !scores || !myPubkey) return [];
    const result: { pubkey: string; name: string; avatar: string; influence: number; content: string; status: string; attestation: Attestation }[] = [];
    for (const att of attestations) {
      if (!isActiveAttestation(att)) continue;
      const score = scores.get(att.attesterPubkey);
      if (score === undefined || score < 0.02) continue;
      let name = att.attesterPubkey.slice(0, 8);
      let avatar = "";
      try {
        const profileEvent = eventStore.getEvent({ kind: 0, pubkey: att.attesterPubkey, identifier: "" });
        if (profileEvent) {
          const profile = JSON.parse(profileEvent.content);
          name = profile.display_name || profile.name || att.attesterPubkey.slice(0, 8);
          avatar = profile.picture || "";
        }
      } catch {}
      result.push({ pubkey: att.attesterPubkey, name, avatar, influence: score, content: att.content, status: getAttestationStatusLabel(att), attestation: att });
      if (result.length >= 5) break;
    }
    return result;
  }, [attestations, fetched, scores, myPubkey]);

  if (trustedVouchers.length === 0 || !myPubkey || pubkey === myPubkey) return null;

  const displayNames = trustedVouchers.slice(0, 2).map(p => p.name);
  const remaining = trustedVouchers.length - displayNames.length;
  const text = remaining > 0
    ? `${displayNames.join(", ")} +${remaining} more`
    : displayNames.join(", ");
  const topContent = trustedVouchers[0]?.content;
  const hasVerified = trustedVouchers.some(v => v.status === "Verified");
  const label = hasVerified ? "Verified by" : "Vouched by";

  return (
    <div className="space-y-0.5" data-testid={`vouched-by-${pubkey.slice(0, 8)}`}>
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="w-3 h-3 text-emerald-500/70 shrink-0" />
        <span className="text-[9px] text-success dark:text-emerald-400/60">
          {label}
        </span>
        <div className="flex -space-x-1.5">
          {trustedVouchers.slice(0, 3).map((p) => (
            <Avatar key={p.pubkey} className="w-3.5 h-3.5 ring-1 ring-emerald-500/20 border border-background">
              <AvatarImage src={p.avatar} alt={`${p.name}'s avatar`} />
              <AvatarFallback className="bg-emerald-900/30 text-success dark:text-emerald-300 text-[6px]">
                {p.name.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          ))}
        </div>
        <span className="text-[9px] text-muted-foreground/50 truncate max-w-[140px]">
          {text}
        </span>
      </div>
      {topContent && (
        <p className="text-[8px] text-success dark:text-emerald-400/40 italic truncate ml-[18px]">
          &ldquo;{topContent.slice(0, 80)}{topContent.length > 80 ? "..." : ""}&rdquo;
        </p>
      )}
    </div>
  );
}

export function TrustedBySection({ pubkey }: { pubkey: string }) {
  const { pubkey: myPubkey, follows } = useNostrAuth();
  const { scores } = useGrapeRankScores();

  const [storeRevision, setStoreRevision] = useState(0);

  useEffect(() => {
    if (!myPubkey || !follows || follows.length === 0) return;
    const t1 = setTimeout(() => setStoreRevision((r) => r + 1), 5000);
    const t2 = setTimeout(() => setStoreRevision((r) => r + 1), 10000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [myPubkey, follows]);

  const trustedProfiles = useMemo(() => {
    void storeRevision;
    if (!scores || !myPubkey || !follows || follows.length === 0) return [];
    const myTrustedFollows: string[] = [];
    for (const f of follows) {
      if (f === myPubkey || f === pubkey) continue;
      const s = scores.get(f);
      if (s !== undefined && s >= 0.5) myTrustedFollows.push(f);
    }
    const result: { pubkey: string; name: string; avatar: string }[] = [];
    for (const pk of myTrustedFollows) {
      try {
        const contactEvent = eventStore.getEvent({ kind: 3, pubkey: pk, identifier: "" });
        if (contactEvent) {
          const followsThem = contactEvent.tags.some(
            (t: string[]) => t[0] === "p" && t[1] === pubkey
          );
          if (followsThem) {
            let name = pk.slice(0, 8);
            let avatar = "";
            try {
              const profileEvent = eventStore.getEvent({ kind: 0, pubkey: pk, identifier: "" });
              if (profileEvent) {
                const profile = JSON.parse(profileEvent.content);
                name = profile.display_name || profile.name || pk.slice(0, 8);
                avatar = profile.picture || "";
              }
            } catch {}
            result.push({ pubkey: pk, name, avatar });
          }
        }
      } catch {}
      if (result.length >= 5) break;
    }
    return result;
  }, [scores, myPubkey, follows, pubkey, storeRevision]);

  if (trustedProfiles.length === 0 || !myPubkey || pubkey === myPubkey) return null;

  const displayNames = trustedProfiles.slice(0, 2).map(p => p.name);
  const remaining = trustedProfiles.length - displayNames.length;
  const text = remaining > 0
    ? `${displayNames.join(", ")} +${remaining} trusted`
    : displayNames.join(", ");

  return (
    <div className="flex items-center gap-1.5 mt-1" data-testid={`trusted-by-${pubkey.slice(0, 8)}`}>
      <span className="text-[9px] text-brand/60 dark:text-brand/50">
        Trusted by
      </span>
      <div className="flex -space-x-1.5">
        {trustedProfiles.slice(0, 3).map((p) => (
          <Avatar key={p.pubkey} className="w-3.5 h-3.5 ring-1 ring-brand/20 border border-background">
            <AvatarImage src={p.avatar} alt={`${p.name}'s avatar`} />
            <AvatarFallback className="bg-foreground/[0.08] text-foreground/80 text-[6px]">
              {p.name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      <span className="text-[9px] text-muted-foreground/50 truncate max-w-[140px]">
        {text}
      </span>
    </div>
  );
}

export function HoverCardTrustBadge({ pubkey }: { pubkey: string }) {
  const { getAuthorTier, isAuthorFlagged, scores, wotEnabled } = useGrapeRankScores();
  const tier = getAuthorTier(pubkey);
  useLazyScoreRequest(pubkey, tier);
  if (!wotEnabled || !scores) return null;
  const flagged = isAuthorFlagged(pubkey);
  if (!flagged && !scores.has(pubkey)) return null;
  // Trust as a word about the reader's network, never a number (trust-words.ts).
  const shown: SignalTier = flagged ? "flagged" : tier;
  const phrase = shown === "none" ? "Not in your network yet" : getTrustPhrase(shown);
  return (
    <span className={`text-[12px] inline-flex items-center gap-1 shrink-0 ${shown === "flagged" ? "font-medium text-danger" : "text-muted-foreground"}`} data-testid="hover-trust-phrase">
      <TrustTierGlyph tier={shown} size={shown === "flagged" ? "w-3 h-3" : "w-2.5 h-2.5"} decorative /> {phrase}
    </span>
  );
}


function supportsHover(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  try {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch {
    return true;
  }
}

export function AuthorHoverCard({ pubkey, children, profile: externalProfile }: { pubkey: string; children: React.ReactNode; profile?: Event }) {
  const npub = useMemo(() => { try { return nip19.npubEncode(pubkey); } catch { return ""; } }, [pubkey]);
  const lookedUpProfile = use$(() => !externalProfile && pubkey ? eventStore.replaceable(KIND_METADATA, pubkey) : undefined, [pubkey, externalProfile]);
  const profile = externalProfile ?? lookedUpProfile;
  useEffect(() => {
    if (!externalProfile && pubkey && !lookedUpProfile) {
      fetchProfilesCached([pubkey]);
    }
  }, [pubkey, externalProfile, lookedUpProfile]);
  const profileContent = useMemo(() => profile ? getProfileContent(profile) : null, [profile]);
  usePetnamesVersion();
  const npubShort = npub ? `${npub.slice(0, 9)}...${npub.slice(-4)}` : "?";
  const displayName = profile ? (getDisplayName(profile, npubShort) ?? npubShort) : npubShort;
  const nip05 = (profileContent as Record<string, string | undefined>)?.nip05 || null;
  const about = (profileContent as Record<string, string | undefined>)?.about || null;
  const lud16 = (profileContent as Record<string, string | undefined>)?.lud16 || null;
  const shortNpub = npub ? `${npub.slice(0, 12)}...${npub.slice(-6)}` : "";
  const [copied, setCopied] = useState(false);
  const [showZapDialog, setShowZapDialog] = useState(false);
  const { toast } = useToast();

  const handleCopyNpub = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    copyNostrId(npub).then(() => {
      setCopied(true);
      toast({ title: "Copied", description: "npub copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      toast({ title: "Failed", description: "Could not copy to clipboard", variant: "destructive" });
    });
  }, [npub, toast]);

  const handleZapClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowZapDialog(true);
  }, []);

  if (!npub) return <>{children}</>;

  // On touch devices the avatar should just be a link to the profile —
  // surfacing the hover card on tap is too easy to trigger by accident
  // while scrolling. Desktop/mouse users still get the rich preview on hover.
  if (!supportsHover()) return <>{children}</>;

  return (
    <HoverCard openDelay={400} closeDelay={150}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-72 p-0 border-0 bg-transparent shadow-none mention-hover-card"
        onClick={(e) => e.stopPropagation()}
        data-testid={`hover-card-author-${pubkey.slice(0, 8)}`}
      >
        <div
          className="relative rounded-xl overflow-hidden border border-brand/20"
          style={{ background: 'var(--mention-hover-solid-bg)', boxShadow: '0 8px 24px var(--mention-hover-shadow)' }}
        >
          <div className="absolute inset-0 mention-hover-radial pointer-events-none" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-[1px] bg-gradient-to-r from-transparent via-brand/50 to-transparent pointer-events-none" />
          <div className="relative z-10 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Link href={`/profile/${npub}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                <PersonAvatar pubkey={pubkey} profile={profile ?? undefined} alt={displayName} className="w-12 h-12 ring-2 ring-brand/30 border-2 border-brand dark:border-[#0d0d2b] shrink-0 cursor-pointer" />
              </Link>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Link href={`/profile/${npub}`} className="no-underline min-w-0" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                    <p className="text-sm font-semibold text-foreground truncate hover:text-brand transition-colors cursor-pointer">
                      {displayName}
                    </p>
                  </Link>
                  <HoverCardTrustBadge pubkey={pubkey} />
                  <PostBadgeIcons pubkey={pubkey} />
                </div>
                {nip05 && (
                  <Nip05Badge nip05={nip05} pubkey={pubkey} className="mt-0.5" textClassName="text-[11px] text-brand/70" iconClassName="w-3 h-3" />
                )}
                <ActivityIndicator pubkey={pubkey} />
              </div>
            </div>
            {about && (
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed line-clamp-2">{about}</p>
            )}
            <VouchedBySection pubkey={pubkey} />
            <TrustedBySection pubkey={pubkey} />
            <div className="space-y-1.5 pt-1">
              <button
                type="button"
                onClick={handleCopyNpub}
                className="flex items-center gap-2 group w-full text-left cursor-pointer hover:bg-muted/50 rounded-md px-1 -mx-1 py-0.5 transition-colors"
              >
                <img src={nostrOstrichGif} alt="" className="w-4 h-4 object-contain shrink-0" />
                <span className="text-[11px] text-muted-foreground/60 font-mono truncate group-hover:text-muted-foreground/80 transition-colors">
                  {shortNpub}
                </span>
                {copied ? (
                  <Check className="w-3 h-3 text-green-800 dark:text-green-400 ml-auto shrink-0" />
                ) : (
                  <Copy className="w-3 h-3 text-muted-foreground/50 ml-auto shrink-0 group-hover:text-muted-foreground/60 transition-colors" />
                )}
              </button>
              {lud16 && (
                <button
                  type="button"
                  onClick={handleZapClick}
                  className="flex items-center gap-2 group w-full text-left cursor-pointer hover:bg-muted/50 rounded-md px-1 -mx-1 py-0.5 transition-colors"
                >
                  <BtcZapIcon className="w-4 h-4 text-amber-800/70 dark:text-amber-400/70 shrink-0" />
                  <span className="text-[11px] text-zap dark:text-amber-300/60 truncate group-hover:text-amber-600/80 dark:group-hover:text-amber-300/80 transition-colors">
                    {lud16}
                  </span>
                  <Zap className="w-3 h-3 text-amber-500/30 dark:text-amber-400/25 ml-auto shrink-0 group-hover:text-amber-500/60 dark:group-hover:text-amber-400/60 transition-colors" />
                </button>
              )}
            </div>
          </div>
        </div>
      </HoverCardContent>
      {lud16 && (
        <ZapDialog
          open={showZapDialog}
          onOpenChange={setShowZapDialog}
          pubkey={pubkey}
          recipientName={displayName}
        />
      )}
    </HoverCard>
  );
}


export { BtcZapIcon };
