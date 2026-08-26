import { BtcZapIcon } from "@/components/icons/BtcZapIcon";
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
import { Copy, Check, ShieldCheck, Zap } from "lucide-react";
import {
  getAvatarUrl,
  getDisplayName,
  getProfileContent,
  KIND_METADATA,
  formatNpub,
  shortenNpub,
} from "@/lib/nostr-helpers";
import { useAttestations, isActiveAttestation, getAttestationStatusLabel, type Attestation } from "@/hooks/use-attestations";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { formatInfluence, getActiveThresholds, getReplyTier } from "@/lib/graperank";
import type { SignalTier } from "@/lib/graperank";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { TrustTierGlyph } from "@/components/nostr-post/trust-tier-glyph";
import { RelayOutpostIcon } from "@/components/RelayOutpostLoader";
import nostrOstrichGif from "@assets/219719339-5eff628c-3470-4cc3-81eb-404f8902de9f_1771392554698.gif";
import { ZapDialog } from "@/components/ZapDialog";

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
  const { getAuthorTier, getAuthorInfluence, isAuthorFlagged, scores, wotEnabled, wotReady } = useGrapeRankScores();
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
        <RelayOutpostIcon className="w-4 h-4 text-brand/70 drop-shadow-[0_0_3px_rgba(147,51,234,0.25)]" />
      </span>
    );
  }

  if (!scores) return null;
  const scoreLookedUp = scores.has(pubkey);
  const flagged = isAuthorFlagged(pubkey);

  if (!scoreLookedUp && !flagged) return null;

  if (flagged) {
    return (
      <Popover open={hover.open} onOpenChange={hover.setOpen}>
        <PopoverTrigger asChild>
          <button
            className="inline-flex items-center justify-center shrink-0 cursor-pointer"
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={hover.handleEnter}
            onMouseLeave={hover.handleLeave}
            aria-label="Trust level: Flagged"
          >
            <TrustTierGlyph tier="flagged" size="w-4 h-4" decorative className="drop-shadow-[0_0_4px_rgba(239,68,68,0.4)]" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-44 p-2.5 border-red-500/25 bg-[rgba(242,238,255,0.98)] dark:bg-[rgba(4,4,10,0.97)] shadow-[0_4px_20px_rgba(239,68,68,0.08)]"
          side="bottom"
          align="start"
          sideOffset={6}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={hover.handleEnter}
          onMouseLeave={hover.handleLeave}
        >
          <div className="flex items-center gap-1.5">
            <TrustTierGlyph tier="flagged" size="w-3.5 h-3.5" decorative />
            <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">Flagged</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 leading-snug mt-1">Reported by 2+ trusted users in your network</p>
        </PopoverContent>
      </Popover>
    );
  }

  if (tier === "none") {
    return (
      <Popover open={hover.open} onOpenChange={hover.setOpen}>
        <PopoverTrigger asChild>
          <button
            className="inline-flex items-center justify-center shrink-0 cursor-pointer"
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={hover.handleEnter}
            onMouseLeave={hover.handleLeave}
            aria-label="Trust info"
          >
            <TrustTierGlyph tier="none" size="w-2.5 h-2.5" decorative />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-44 p-2.5 border-border/40 bg-[rgba(242,238,255,0.98)] dark:bg-[rgba(4,4,10,0.97)] shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
          side="bottom"
          align="start"
          sideOffset={6}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={hover.handleEnter}
          onMouseLeave={hover.handleLeave}
        >
          <div className="flex items-center gap-1.5">
            <TrustTierGlyph tier="none" size="w-2.5 h-2.5" decorative />
            <span className="text-[11px] font-semibold text-muted-foreground/70">No Signal</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 leading-snug mt-1">Not yet verified by your trust network</p>
          <p className="text-[8px] text-muted-foreground/35 mt-1">GrapeRank Web of Trust</p>
        </PopoverContent>
      </Popover>
    );
  }

  if (tier === "weak") {
    const wt = getActiveThresholds();
    const weakRange = `${Math.round(wt.weak * 100)}%–${Math.round(wt.low * 100) - 1}%`;
    return (
      <Popover open={hover.open} onOpenChange={hover.setOpen}>
        <PopoverTrigger asChild>
          <button
            className="inline-flex items-center justify-center shrink-0 cursor-pointer"
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={hover.handleEnter}
            onMouseLeave={hover.handleLeave}
            aria-label="Trust level: Low Trust"
          >
            <TrustTierGlyph tier="weak" size="w-2 h-2" decorative />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-44 p-2.5 border-amber-500/20 bg-[rgba(242,238,255,0.98)] dark:bg-[rgba(4,4,10,0.97)] shadow-[0_4px_20px_rgba(245,158,11,0.06)]"
          side="bottom"
          align="start"
          sideOffset={6}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={hover.handleEnter}
          onMouseLeave={hover.handleLeave}
        >
          <div className="flex items-center gap-1.5">
            <TrustTierGlyph tier="weak" size="w-2 h-2" decorative />
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">Low Trust</span>
            <span className="text-[10px] font-mono text-muted-foreground/50 ml-auto">{weakRange}</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 leading-snug mt-1">Minimal trust score in your network</p>
        </PopoverContent>
      </Popover>
    );
  }

  const influence = getAuthorInfluence(pubkey);
  const label = tier === "strong" ? "Highly Trusted"
    : tier === "moderate" ? "Trusted"
    : "Neutral";
  const tierThresholds = getActiveThresholds();
  const desc = tier === "strong" ? `Top-tier trust · ${Math.round(tierThresholds.strong * 100)}%+ influence`
    : tier === "moderate" ? `Recognized by your trusted connections · ${Math.round(tierThresholds.moderate * 100)}%–${Math.round(tierThresholds.strong * 100) - 1}%`
    : `Some presence in your trust graph · ${Math.round(tierThresholds.low * 100)}%–${Math.round(tierThresholds.moderate * 100) - 1}%`;
  const labelColor = tier === "strong"
    ? "text-emerald-700 dark:text-emerald-400"
    : tier === "moderate"
    ? "text-blue-700 dark:text-blue-400"
    : "text-cyan-700 dark:text-cyan-400";
  const borderColor = tier === "strong"
    ? "border-emerald-500/25 shadow-[0_4px_20px_rgba(16,185,129,0.08)]"
    : tier === "moderate"
    ? "border-blue-500/25 shadow-[0_4px_20px_rgba(59,130,246,0.08)]"
    : "border-cyan-500/20 shadow-[0_4px_20px_rgba(34,211,238,0.06)]";
  const scoreColor = tier === "strong"
    ? "text-emerald-600 dark:text-emerald-400"
    : tier === "moderate"
    ? "text-blue-600 dark:text-blue-400"
    : "text-cyan-600 dark:text-cyan-400";

  return (
    <Popover open={hover.open} onOpenChange={hover.setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center justify-center shrink-0 cursor-pointer"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={hover.handleEnter}
          onMouseLeave={hover.handleLeave}
          aria-label={`Trust level: ${label}`}
        >
          <TrustTierGlyph tier={tier} size="w-2 h-2" decorative />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={`w-48 p-2.5 bg-[rgba(242,238,255,0.98)] dark:bg-[rgba(4,4,10,0.97)] ${borderColor}`}
        side="bottom"
        align="start"
        sideOffset={6}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={hover.handleEnter}
        onMouseLeave={hover.handleLeave}
      >
        <div className="flex items-center gap-1.5">
          <TrustTierGlyph tier={tier} size="w-2 h-2" decorative />
          <span className={`text-[11px] font-semibold ${labelColor}`}>{label}</span>
          <span className={`text-[10px] font-mono ml-auto ${scoreColor}`}>{formatInfluence(influence)}</span>
        </div>
        <p className="text-[10px] text-muted-foreground/60 leading-snug mt-1">{desc}</p>
        <p className="text-[8px] text-muted-foreground/35 mt-1">GrapeRank Web of Trust</p>
      </PopoverContent>
    </Popover>
  );
}

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
      warning = `${flagged} flagged account${flagged > 1 ? "s" : ""} active — reported by 2+ trusted users`;
    } else if (total >= 10 && scoredCount >= 3 && concentration > 0.85 && median < 0.02) {
      warning = "High volume from low-scored accounts — trust weight concentrated in few participants";
    } else if (noSignalRatio > 0.6) {
      warning = `${Math.round(noSignalRatio * 100)}% of participants carry little or no trust signal`;
    } else if (total >= 5 && avgInfluence < 0.01 && scoredCount >= total * 0.5) {
      warning = `Low avg influence (${avgInfluence.toFixed(4)}) despite ${scoredCount} scored accounts`;
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

  const segments = [
    { count: strong, color: "bg-emerald-500", label: "Highly Trusted", tierId: "strong" },
    { count: moderate, color: "bg-blue-500", label: "Trusted", tierId: "moderate" },
    { count: low, color: "bg-cyan-500", label: "Neutral", tierId: "low" },
    { count: weak, color: "bg-red-400", label: "Low Trust", tierId: "weak" },
    // Genuinely scored low vs. simply no data — kept distinct so filtering out
    // low-trust accounts never silently buries content we just lack a score for.
    { count: unverified, color: "bg-slate-500/60 dark:bg-slate-400/50", label: "Unverified", tierId: "unverified" },
    { count: unknown, color: "bg-slate-400/25 dark:bg-slate-500/25", label: "No data", tierId: "unknown" },
    { count: flagged, color: "bg-red-600", label: "Flagged", tierId: "flagged" },
  ].filter(s => s.count > 0);

  const hasActiveFilter = excludedTiers.size > 0;

  const filteredCount = hasActiveFilter
    ? segments.reduce((sum, seg) => sum + (excludedTiers.has(seg.tierId) ? 0 : seg.count), 0)
    : total;

  const avgColor = avgInfluence >= 0.15 ? "text-emerald-600 dark:text-emerald-400"
    : avgInfluence >= 0.02 ? "text-blue-600 dark:text-blue-400"
    : avgInfluence > 0 ? "text-cyan-600 dark:text-cyan-400"
    : "text-slate-500 dark:text-slate-400";

  const concColor = concentration > 0.85 ? "text-red-500 dark:text-red-400"
    : concentration > 0.6 ? "text-amber-600 dark:text-amber-400"
    : "text-emerald-600 dark:text-emerald-400";

  return (
    <div className="px-4 py-2.5 sm:py-3 border-b border-border/20 space-y-2" data-testid="thread-trust-bar">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2.5 rounded-full overflow-hidden flex gap-px bg-slate-500/15 dark:bg-slate-400/10">
          {segments.map((seg, i) => {
            const excluded = excludedTiers.has(seg.tierId);
            return (
              <div
                key={seg.label}
                className={`${seg.color} transition-all duration-300 ${i === 0 ? "rounded-l-full" : ""} ${i === segments.length - 1 ? "rounded-r-full" : ""} ${excluded ? "opacity-20" : ""}`}
                style={{ width: `${(seg.count / total) * 100}%`, minWidth: seg.count > 0 ? "4px" : 0 }}
                title={`${seg.label}: ${seg.count}`}
              />
            );
          })}
        </div>
        <span className="text-[10px] sm:text-[11px] text-muted-foreground/80 dark:text-muted-foreground/70 shrink-0 tabular-nums font-medium">
          {hasActiveFilter ? `${filteredCount}/${total}` : total} reply authors
        </span>
      </div>
      <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
        {segments.map((seg) => {
          const excluded = excludedTiers.has(seg.tierId);
          return (
            <button
              key={seg.label}
              onClick={() => toggleTier(seg.tierId)}
              className={`flex items-center gap-1 text-[10px] sm:text-[11px] transition-all duration-200 cursor-pointer rounded px-1 -mx-1 py-0.5 hover:bg-white/[0.04] ${excluded ? "opacity-35 line-through decoration-1" : "text-foreground/70 dark:text-foreground/60"}`}
            >
              <span className={`w-2 h-2 rounded-full transition-opacity duration-200 ${seg.color} ${excluded ? "opacity-40" : ""}`} />
              <span className="font-medium">{seg.label}</span> <span className="tabular-nums">{seg.count}</span>
            </button>
          );
        })}
        {hasActiveFilter && (
          <button
            onClick={() => onFilterChange(new Set())}
            className="text-[10px] sm:text-[11px] text-brand/70 hover:text-brand-strong transition-colors ml-1 cursor-pointer"
          >
            Show all
          </button>
        )}
      </div>
      {scoredCount > 0 && (
        <div className="flex items-center gap-3 sm:gap-4 pt-0.5">
          <span className="text-[10px] sm:text-[11px] text-muted-foreground/70 dark:text-muted-foreground/60">
            Avg <span className={`font-mono font-bold ${avgColor}`}>{avgInfluence.toFixed(4)}</span>
          </span>
          <span className="text-[10px] sm:text-[11px] text-muted-foreground/70 dark:text-muted-foreground/60">
            Med <span className={`font-mono font-bold ${avgColor}`}>{median.toFixed(4)}</span>
          </span>
          {total >= 4 && (
            <span className="text-[10px] sm:text-[11px] text-muted-foreground/70 dark:text-muted-foreground/60" title={`Top ${topN} account${topN > 1 ? "s" : ""} hold ${Math.round(concentration * 100)}% of total trust weight`}>
              Top {topN} hold <span className={`font-mono font-bold ${concColor}`}>{Math.round(concentration * 100)}%</span> weight
            </span>
          )}
        </div>
      )}
      {warning && (
        <p className="text-[11px] sm:text-xs text-amber-600 dark:text-amber-400 italic font-medium">
          ⚠ {warning}
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
        <span className="text-[9px] text-emerald-600/70 dark:text-emerald-400/60">
          {label}
        </span>
        <div className="flex -space-x-1.5">
          {trustedVouchers.slice(0, 3).map((p) => (
            <Avatar key={p.pubkey} className="w-3.5 h-3.5 ring-1 ring-emerald-500/20 border border-background">
              <AvatarImage src={p.avatar} alt={`${p.name}'s avatar`} />
              <AvatarFallback className="bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 text-[6px]">
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
        <p className="text-[8px] text-emerald-600/50 dark:text-emerald-400/40 italic truncate ml-[18px]">
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
            <AvatarFallback className="bg-brand/30 text-brand text-[6px]">
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
  const { getAuthorTier, getAuthorInfluence, isAuthorFlagged, scores, wotEnabled } = useGrapeRankScores();
  const tier = getAuthorTier(pubkey);
  useLazyScoreRequest(pubkey, tier);
  if (!wotEnabled || !scores) return null;
  const scoreLookedUp = scores.has(pubkey);
  const flagged = isAuthorFlagged(pubkey);
  if (flagged) {
    return (
      <span className="text-[9px] font-medium px-1.5 py-0 rounded-full border shrink-0 bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30 inline-flex items-center gap-0.5">
        <TrustTierGlyph tier="flagged" size="w-2.5 h-2.5" decorative /> Flagged
      </span>
    );
  }
  if (!scoreLookedUp) return null;
  if (tier === "none") {
    return (
      <span className="text-[9px] font-medium px-1.5 py-0 rounded-full border shrink-0 inline-flex items-center gap-0.5 bg-muted/30 text-muted-foreground/50 border-border/30">
        <TrustTierGlyph tier="none" size="w-2 h-2" decorative /> No Signal
      </span>
    );
  }
  const influence = getAuthorInfluence(pubkey);
  const badgeStyle = tier === "strong"
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
    : tier === "moderate"
    ? "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30"
    : tier === "low"
    ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30"
    : "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
  const label = tier === "strong" ? "Highly Trusted" : tier === "moderate" ? "Trusted" : tier === "low" ? "Neutral" : "Low Trust";
  return (
    <span className={`text-[9px] font-medium px-1.5 py-0 rounded-full border shrink-0 inline-flex items-center gap-0.5 ${badgeStyle}`}>
      {tier === "weak" && <TrustTierGlyph tier="weak" size="w-2 h-2" decorative />}
      {label} · {formatInfluence(influence)}
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
  const displayName = useMemo(() => {
    if (!profileContent) return npub ? `${npub.slice(0, 9)}...${npub.slice(-4)}` : "?";
    return profileContent.display_name || profileContent.name || `${npub.slice(0, 9)}...${npub.slice(-4)}`;
  }, [profileContent, npub]);
  const avatarUrl = getAvatarUrl(profile);
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
                <Avatar className="w-12 h-12 ring-2 ring-brand/30 border-2 border-brand dark:border-[#0d0d2b] shrink-0 cursor-pointer">
                  <AvatarImage src={avatarUrl} alt={displayName} />
                  <AvatarFallback className="bg-brand/40 text-brand text-sm font-bold">
                    {displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
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
                  <span className="text-[11px] text-amber-600/60 dark:text-amber-300/60 truncate group-hover:text-amber-600/80 dark:group-hover:text-amber-300/80 transition-colors">
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
