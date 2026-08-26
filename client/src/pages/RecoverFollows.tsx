import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import { use$ } from "applesauce-react/hooks";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { useNostrMuteList } from "@/hooks/use-nostr-mute-list";
import {
  pool, eventStore, DEFAULT_RELAYS, publishEvent, verifySignedEventKind, fetchProfilesCached,
} from "@/lib/nostr";
import { getWriteRelays, getReadRelays } from "@/lib/outbox";
import {
  KIND_FOLLOW_LIST, KIND_METADATA, getDisplayName, getAvatarUrl, formatNpub, shortenNpub,
} from "@/lib/nostr-helpers";
import { loadFollowBase, cacheFollowEvent } from "@/lib/follow-list";
import { signWithTimeout } from "@/lib/signer-timeout";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { RelayOutpostLoader } from "@/components/RelayOutpostLoader";
import { ConfirmAction } from "@/components/ConfirmAction";
import { TrustTierGlyph } from "@/components/nostr-post/trust-tier-glyph";
import { computeFollowHealth } from "@/lib/follow-health";
import { fetchLastPostTimestamps, loadActivityCache } from "@/lib/follow-activity";
import {
  rankFlagVerdicts, severityFromReportTypes, reportTypesFromEvent,
  type FlagVerdict, type Severity,
} from "@/lib/follow-flag-verdict";
import {
  loadFlagSeen, saveFlagSeen, computeNewlyFlagged, loadReviewed, saveReviewed,
} from "@/lib/wot-history";
import {
  History, ShieldCheck, RotateCcw, Clock, UserMinus, VolumeX, Check, ShieldQuestion, Heart, ChevronDown,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Event } from "nostr-tools";

/**
 * Follow-list health. Three stacked cards over your OWN follow list:
 *   1. Recover follows — the original one-off relay-scan restore (unchanged).
 *   2. Flagged by your network — follows ≥2 trusted accounts flagged.
 *   3. Gone quiet — follows silent for >90 days.
 * Every action (unfollow / mute) is confirmed and manual; "Keep" just marks a row
 * reviewed so it stops nagging. Calm and factual — no red-alert styling.
 */

const FLAG_THRESHOLD = 2;

// ─── Recover follows (original page, now the first card) ──────────────────────

const SCAN_RELAYS = [
  "wss://nostr21.com", "wss://relay.nostr.band", "wss://purplepag.es",
  "wss://relay.primal.net", "wss://relay.damus.io", "wss://nos.lol",
  "wss://nostr.wine", "wss://relay.snort.social",
];

function pCount(e: Event): number {
  return e.tags.filter((t) => t[0] === "p").length;
}

function RecoverFollowsCard() {
  const { pubkey, signer, updateFollows } = useNostrAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [newest, setNewest] = useState<Event | null>(null);
  const [best, setBest] = useState<Event | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [done, setDone] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const scan = useCallback(async () => {
    if (!pubkey) return;
    setLoading(true);
    const relays = Array.from(new Set([
      ...getWriteRelays(pubkey), ...getReadRelays(pubkey), ...DEFAULT_RELAYS, ...SCAN_RELAYS,
    ])).filter(Boolean);
    try {
      const events = await pool.querySync(relays, { kinds: [KIND_FOLLOW_LIST], authors: [pubkey] }, { maxWait: 8000 } as any);
      if (events.length) {
        const byNewest = [...events].sort((a, b) => b.created_at - a.created_at);
        const byFullest = [...events].sort((a, b) => pCount(b) - pCount(a));
        setNewest(byNewest[0]);
        setBest(byFullest[0]);
      }
    } catch {
      toast({ title: "Couldn't reach relays", description: "Try again in a moment.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [pubkey, toast]);

  useEffect(() => { scan(); }, [scan]);

  const restore = useCallback(async () => {
    if (!signer || !best || !pubkey) return;
    setRestoring(true);
    try {
      const tpl = {
        kind: KIND_FOLLOW_LIST,
        created_at: Math.floor(Date.now() / 1000),
        tags: [...best.tags],
        content: best.content || "",
      };
      const signed = await signWithTimeout(signer, tpl);
      if (!verifySignedEventKind(signed, KIND_FOLLOW_LIST)) {
        toast({ title: "Signer error", description: "Your signer changed the event type — nothing was published.", variant: "destructive" });
        return;
      }
      const pubRelays = Array.from(new Set([...getWriteRelays(pubkey), ...DEFAULT_RELAYS])).filter(Boolean);
      await publishEvent(signed as Event, pubRelays);
      eventStore.add(signed as Event);
      updateFollows(() => (signed as Event).tags.filter((t) => t[0] === "p").map((t) => t[1]));
      setDone(true);
      toast({ title: "Follow list restored", description: `Republished ${pCount(best)} follows.` });
    } catch (err) {
      toast({ title: "Restore failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setRestoring(false);
    }
  }, [signer, best, pubkey, updateFollows, toast]);

  const newestCount = newest ? pCount(newest) : 0;
  const bestCount = best ? pCount(best) : 0;
  const recoverable = bestCount > newestCount;

  return (
    <Card className="glass-card p-6 space-y-4" data-testid="card-recover">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/15 text-brand">
          <History className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold text-foreground">Recover follows</h2>
      </div>

      {loading ? (
        <div className="py-6 flex justify-center"><RelayOutpostLoader size="md" label="Scanning relays…" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-lg border border-border/40 bg-muted/10 p-4">
              <div className="text-2xl font-semibold">{newestCount}</div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mt-1">Current (newest)</div>
            </div>
            <div className="rounded-lg border border-brand/30 bg-brand/[0.06] p-4">
              <div className="text-2xl font-semibold text-brand">{bestCount}</div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mt-1">Best found{best ? ` · ${new Date(best.created_at * 1000).toLocaleDateString()}` : ""}</div>
            </div>
          </div>

          {done ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="h-4 w-4 shrink-0" /> Restored {bestCount} follows. Give relays a moment, then refresh — your follows are back.
            </div>
          ) : recoverable ? (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                A fuller follow list ({bestCount}) still exists on relays. Restore republishes it with a fresh timestamp so it overrides the current {newestCount}-follow list everywhere.
              </p>
              <Button onClick={() => setShowConfirm(true)} disabled={restoring} className="w-full min-h-11 gap-2 bg-brand text-white hover:bg-brand" data-testid="button-recover-restore">
                <RotateCcw className={`h-4 w-4 ${restoring ? "animate-spin" : ""}`} />
                {restoring ? "Restoring…" : `Restore ${bestCount} follows`}
              </Button>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              Nothing fuller to recover — your newest list ({newestCount}) is already the largest found across relays.
            </p>
          )}

          <button onClick={scan} disabled={restoring} className="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">Re-scan relays</button>
        </>
      )}

      <ConfirmAction
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title={`Restore ${bestCount} follows?`}
        description={`This republishes your follow list to your relays and overwrites your current ${newestCount}-follow list everywhere. Your ${bestCount}-follow list becomes the one every client sees.`}
        confirmLabel={`Restore ${bestCount} follows`}
        variant="default"
        onConfirm={() => { void restore(); }}
      />
    </Card>
  );
}

// ─── A single at-risk follow row (shared by both health cards) ────────────────

// Verdict chip colouring — calm by design. "Strong" earns the only red; a
// "weak" verdict is muted (presumption of innocence, not an alarm). A
// trusted-but-flagged verdict (reassuring) leads with trust and gets a calm
// violet treatment so it never reads like the amber/red "act on this" rows.
function verdictChipClasses(verdict: FlagVerdict): string {
  if (verdict.reassuring) {
    return "bg-brand/10 text-brand border border-brand/25";
  }
  switch (verdict.level) {
    case "strong": return "bg-red-500/10 text-red-600 dark:text-red-300 border border-red-400/30";
    case "worth-a-look": return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-400/30";
    case "weak": return "bg-muted/40 text-muted-foreground/80 border border-border/40";
  }
}

function HealthRow({
  pubkey, subtitle, isNew, verdict, onUnfollow, onMute, onKeep,
}: {
  pubkey: string;
  subtitle?: string;
  isNew?: boolean;
  verdict?: FlagVerdict;
  onUnfollow: () => void;
  onMute: () => void;
  onKeep: () => void;
}) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const name = profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey));
  const avatar = profile ? getAvatarUrl(profile) : undefined;
  const npub = formatNpub(pubkey);

  return (
    <div className="flex items-center gap-2.5 py-2.5 border-b border-border/30 last:border-b-0">
      <Link href={`/profile/${npub}`} className="flex items-center gap-2.5 flex-1 min-w-0">
        <Avatar className="w-9 h-9 shrink-0">
          {avatar && <AvatarImage src={avatar} alt={name} />}
          <AvatarFallback className="text-[10px] bg-brand/10 text-brand">
            {name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground/90 truncate">{name}</span>
            {verdict && verdict.standingTier !== "none" && (
              <TrustTierGlyph
                tier={verdict.standingTier}
                size="w-2 h-2"
                title={`Their standing in your network`}
              />
            )}
            {isNew && (
              <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-brand/15 text-brand">New</span>
            )}
          </div>
          {verdict ? (
            <span className={`inline-block mt-0.5 text-[11px] leading-snug px-1.5 py-0.5 rounded-md ${verdictChipClasses(verdict)}`}>
              {verdict.summary}
            </span>
          ) : (
            <p className="text-xs text-muted-foreground/70 truncate">{subtitle}</p>
          )}
        </div>
      </Link>
      {/* Action buttons carry a VISIBLE text label under each icon — hover
          titles are invisible on touch, and the checkmark in particular must
          read unambiguously as "Keep". Tap targets stay ≥44px. */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={onKeep}
          title="Keep — dismiss from this list"
          aria-label={`Keep ${name}`}
          className="flex flex-col items-center justify-center gap-0.5 min-h-11 min-w-11 px-1.5 py-1 rounded-lg text-muted-foreground/70 hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors"
          data-testid={`button-keep-${pubkey.slice(0, 8)}`}
        >
          <Check className="h-4 w-4" />
          <span className="text-[10px] leading-none font-medium">Keep</span>
        </button>
        <button
          onClick={onMute}
          title="Mute"
          aria-label={`Mute ${name}`}
          className="flex flex-col items-center justify-center gap-0.5 min-h-11 min-w-11 px-1.5 py-1 rounded-lg text-muted-foreground/70 hover:text-amber-600 hover:bg-amber-500/10 transition-colors"
          data-testid={`button-mute-${pubkey.slice(0, 8)}`}
        >
          <VolumeX className="h-4 w-4" />
          <span className="text-[10px] leading-none font-medium">Mute</span>
        </button>
        <button
          onClick={onUnfollow}
          title="Unfollow"
          aria-label={`Unfollow ${name}`}
          className="flex flex-col items-center justify-center gap-0.5 min-h-11 min-w-11 px-1.5 py-1 rounded-lg text-muted-foreground/70 hover:text-red-600 hover:bg-red-500/10 transition-colors"
          data-testid={`button-unfollow-${pubkey.slice(0, 8)}`}
        >
          <UserMinus className="h-4 w-4" />
          <span className="text-[10px] leading-none font-medium">Unfollow</span>
        </button>
      </div>
    </div>
  );
}

// A calm "scan still running" line — distinguishes an in-progress scan from a
// genuine all-clear, so an empty section never reads as a false reassurance.
function ScanningNote({ progress }: { progress?: { done: number; total: number } | null }) {
  return (
    <p className="text-sm text-muted-foreground/60 py-1" data-testid="text-scanning">
      Still checking your follows… come back in a moment.
      {progress && progress.total > 0 ? ` (${progress.done}/${progress.total})` : ""}
    </p>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type ConfirmState = { kind: "unfollow" | "mute"; pubkey: string; name: string } | null;

export default function FollowListHealth() {
  useDocumentTitle("Follow list");
  const { pubkey, signer, follows, updateFollows } = useNostrAuth();
  const { toast } = useToast();
  const { flagReporterCounts, reportedBy, scores, loading: wotLoading, wotEnabled, wotReady } = useGrapeRankScores();
  const { mutePubkey } = useNostrMuteList();

  const [reviewed, setReviewed] = useState<Set<string>>(() => (pubkey ? loadReviewed(pubkey) : new Set()));
  const [lastPostAt, setLastPostAt] = useState<Map<string, number>>(() => (pubkey ? loadActivityCache(pubkey) : new Map()));
  const [activityProgress, setActivityProgress] = useState<{ done: number; total: number } | null>(null);
  const [activityScanned, setActivityScanned] = useState(false);
  // Severity of each flagged candidate's reports (kind-1984), best-effort.
  const [severities, setSeverities] = useState<Map<string, { severity: Severity; label?: string }>>(new Map());
  const [newlyFlagged, setNewlyFlagged] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const activityStartedRef = useRef(false);

  const followList = useMemo(() => follows ?? [], [follows]);

  // Keep reviewed set scoped to the signed-in account.
  useEffect(() => { if (pubkey) setReviewed(loadReviewed(pubkey)); }, [pubkey]);

  const markReviewed = useCallback((target: string) => {
    if (!pubkey) return;
    setReviewed((prev) => {
      const next = new Set(prev);
      next.add(target);
      saveReviewed(pubkey, next);
      return next;
    });
  }, [pubkey]);

  // ── Compute the two at-risk lists (pure). ──
  const health = useMemo(() => computeFollowHealth({
    follows: followList,
    self: pubkey,
    flagReporterCounts: flagReporterCounts ?? new Map(),
    lastPostAt,
    reviewed,
    now: Math.floor(Date.now() / 1000),
    flagThreshold: FLAG_THRESHOLD,
  }), [followList, pubkey, flagReporterCounts, lastPostAt, reviewed]);

  // ── Warm profile metadata for the rows we render. ──
  useEffect(() => {
    const pks = [...health.flagged.map((f) => f.pubkey), ...health.stagnant.map((s) => s.pubkey)];
    if (pks.length) fetchProfilesCached(pks);
  }, [health]);

  // ── Evidence-vs-standing verdict per flagged candidate (pure), strong-first. ──
  const flaggedVerdicts = useMemo(() => rankFlagVerdicts(
    health.flagged.map((f) => {
      const info = severities.get(f.pubkey);
      return {
        pubkey: f.pubkey,
        targetInfluence: scores?.get(f.pubkey) ?? null,
        reporters: (reportedBy?.get(f.pubkey) ?? []).map((r) => ({ pubkey: r.pubkey, influence: r.influence })),
        reporterCount: f.reporters,
        severity: info?.severity ?? "neutral",
        reasonLabel: info?.label,
      };
    }),
  ), [health.flagged, scores, reportedBy, severities]);

  // ── Best-effort severity read for the (small) flagged set: one bounded
  //    kind-1984 query for the reports naming these candidates. Severe reasons
  //    (impersonation / illegal) resist standing mitigation in the verdict. ──
  const flaggedKey = health.flagged.map((f) => f.pubkey).join(",");
  useEffect(() => {
    const candidates = health.flagged.map((f) => f.pubkey);
    if (!pubkey || candidates.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const relays = Array.from(new Set([
          ...getReadRelays(pubkey), ...getWriteRelays(pubkey), ...DEFAULT_RELAYS,
        ])).filter(Boolean).slice(0, 8);
        const events = await pool.querySync(
          relays,
          { kinds: [1984], "#p": candidates, limit: candidates.length * 8 },
          { maxWait: 4000 } as any,
        );
        const typesByTarget = new Map<string, string[]>();
        for (const ev of events) {
          for (const target of candidates) {
            const types = reportTypesFromEvent(ev, target);
            if (types.length) {
              const arr = typesByTarget.get(target) ?? [];
              arr.push(...types);
              typesByTarget.set(target, arr);
            }
          }
        }
        if (cancelled) return;
        const next = new Map<string, { severity: Severity; label?: string }>();
        for (const [target, types] of typesByTarget) {
          const severity = severityFromReportTypes(types);
          const label = severity === "neutral"
            ? undefined
            : types.map((t) => t.toLowerCase()).find((t) =>
                severity === "severe"
                  ? ["illegal", "impersonation", "malware"].includes(t)
                  : ["spam", "profanity", "nudity"].includes(t));
          next.set(target, { severity, label });
        }
        setSeverities(next);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [flaggedKey, pubkey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── "New" markers: which flagged follows just crossed the threshold. ──
  useEffect(() => {
    if (!pubkey || !flagReporterCounts) return;
    const prev = loadFlagSeen(pubkey);
    const { newlyFlagged: nf, nextSeen } = computeNewlyFlagged(prev, flagReporterCounts, FLAG_THRESHOLD);
    setNewlyFlagged(new Set(nf));
    saveFlagSeen(pubkey, nextSeen);
  }, [pubkey, flagReporterCounts]);

  // Score-history snapshots accumulate app-wide in GrapeRankScoresContext when
  // scores load — no per-page trigger needed here.

  // ── Gone-quiet activity fetch: lazy, batched, cached, non-blocking. ──
  useEffect(() => {
    if (!pubkey || followList.length === 0) return;
    if (activityStartedRef.current) return;
    activityStartedRef.current = true;
    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      try {
        const map = await fetchLastPostTimestamps(pubkey, followList, {
          signal: ac.signal,
          onProgress: (done, total) => { if (!cancelled) setActivityProgress(total > 0 ? { done, total } : null); },
        });
        if (!cancelled) { setLastPostAt(map); setActivityScanned(true); }
      } finally {
        if (!cancelled) setActivityProgress(null);
      }
    })();
    return () => { cancelled = true; ac.abort(); };
  }, [pubkey, followList]);

  // ── Actions ──
  const unfollow = useCallback(async (target: string) => {
    if (!pubkey || !signer) return;
    try {
      const { base, blocked } = await loadFollowBase(pubkey, followList.length);
      if (blocked) {
        toast({ title: "Couldn't load your follow list", description: "Try again in a moment — your follows are safe, we just need to fetch the list first.", variant: "destructive" });
        return;
      }
      const existingTags: string[][] = base ? [...base.tags] : [];
      if (!existingTags.some((t) => t[0] === "p" && t[1] === target)) {
        // Already not on the authoritative list — just drop it from the UI.
        updateFollows((prev) => prev.filter((pk) => pk !== target));
        return;
      }
      const newTags = existingTags.filter((t) => !(t[0] === "p" && t[1] === target));
      const event = {
        kind: KIND_FOLLOW_LIST,
        created_at: Math.floor(Date.now() / 1000),
        tags: newTags,
        content: base?.content || "",
      };
      updateFollows((prev) => prev.filter((pk) => pk !== target));
      const signed = await signWithTimeout(signer, event);
      if (!verifySignedEventKind(signed, KIND_FOLLOW_LIST)) {
        toast({ title: "Signer error", description: "Your signer modified the event type — unfollow was not applied.", variant: "destructive" });
        updateFollows((prev) => (prev.includes(target) ? prev : [...prev, target]));
        return;
      }
      await publishEvent(signed as Event);
      cacheFollowEvent(signed as Event, { force: true });
      toast({ title: "Unfollowed" });
    } catch (err) {
      updateFollows((prev) => (prev.includes(target) ? prev : [...prev, target]));
      toast({ title: "Failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    }
  }, [pubkey, signer, followList, updateFollows, toast]);

  const mute = useCallback(async (target: string) => {
    try {
      await mutePubkey(target);
      markReviewed(target);
      toast({ title: "Muted" });
    } catch (err) {
      toast({ title: "Couldn't mute", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    }
  }, [mutePubkey, markReviewed, toast]);

  const resolveConfirm = useCallback(() => {
    if (!confirm) return;
    const { kind, pubkey: target } = confirm;
    setConfirm(null);
    if (kind === "unfollow") void unfollow(target);
    else void mute(target);
  }, [confirm, unfollow, mute]);

  // Best-effort display name for the confirm copy (no hook — reads the store).
  const nameFor = useCallback((target: string) => {
    const ev = eventStore.getReplaceable(KIND_METADATA, target);
    return ev ? getDisplayName(ev) : shortenNpub(formatNpub(target));
  }, []);

  if (!pubkey) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12">
        <Card className="glass-card p-6 text-center text-sm text-muted-foreground">Sign in to review your follow list.</Card>
      </div>
    );
  }

  const wotAvailable = wotEnabled && wotReady;

  // Partition the flagged rows: prominent (genuine signals) render as before;
  // suppressed rows (top-standing-not-escalated + mild-on-trusted, e.g.
  // fiatjaf / jb55) collapse into a calm "you trust these" expander below.
  const prominentFlagged = flaggedVerdicts.filter((v) => !v.suppressed);
  const trustedFlagged = flaggedVerdicts.filter((v) => v.suppressed);

  return (
    <div className="max-w-xl mx-auto px-4 py-10 space-y-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/15 text-brand">
          <Heart className="h-4 w-4" />
        </span>
        <div>
          <h1 className="text-lg font-brand uppercase tracking-widest leading-tight">Follow list health</h1>
          <p className="text-xs text-muted-foreground/70">Keep your follows healthy — recover, review, and tidy up.</p>
        </div>
      </div>

      <RecoverFollowsCard />

      {/* ── Flagged by your network ── */}
      <Card className="glass-card p-6 space-y-3" data-testid="card-flagged">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-500 dark:text-red-400">
            <TrustTierGlyph tier="flagged" size="w-4 h-4" decorative />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Flagged by your network</h2>
            <p className="text-xs text-muted-foreground/70">Follows flagged by {FLAG_THRESHOLD}+ people you trust.</p>
          </div>
        </div>

        {!wotAvailable ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-border/40 bg-muted/10 p-3 text-sm text-muted-foreground">
            <ShieldQuestion className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground/60" />
            <span>Turn on Web of Trust (Trust &amp; safety) to see which of your follows your network has flagged.</span>
          </div>
        ) : flaggedVerdicts.length > 0 ? (
          <div className="space-y-3">
            {prominentFlagged.length > 0 && (
              <div>
                {prominentFlagged.map((v) => (
                  <HealthRow
                    key={v.pubkey}
                    pubkey={v.pubkey}
                    isNew={newlyFlagged.has(v.pubkey)}
                    verdict={v}
                    onKeep={() => markReviewed(v.pubkey)}
                    onMute={() => setConfirm({ kind: "mute", pubkey: v.pubkey, name: nameFor(v.pubkey) })}
                    onUnfollow={() => setConfirm({ kind: "unfollow", pubkey: v.pubkey, name: nameFor(v.pubkey) })}
                  />
                ))}
              </div>
            )}

            {/* Trusted-but-flagged: collapsed, calm, no red/amber. These are
                accounts you trust (fiatjaf / jb55) whose standing suppressed
                the flag — reassurance, not alarm. Same actions inside. */}
            {trustedFlagged.length > 0 && (
              <Collapsible className="rounded-lg border border-border/40 bg-muted/[0.04]">
                <CollapsibleTrigger
                  className="group flex w-full items-center gap-2.5 p-3 text-left min-h-11"
                  data-testid="button-trusted-flagged-toggle"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                    <ShieldCheck className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground/90">
                      {trustedFlagged.length} account{trustedFlagged.length === 1 ? "" : "s"} you trust {trustedFlagged.length === 1 ? "was" : "were"} also flagged
                    </span>
                    <span className="block text-xs text-muted-foreground/70">You trust these — tap to review</span>
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-3 pb-1">
                    {trustedFlagged.map((v) => (
                      <HealthRow
                        key={v.pubkey}
                        pubkey={v.pubkey}
                        isNew={newlyFlagged.has(v.pubkey)}
                        verdict={v}
                        onKeep={() => markReviewed(v.pubkey)}
                        onMute={() => setConfirm({ kind: "mute", pubkey: v.pubkey, name: nameFor(v.pubkey) })}
                        onUnfollow={() => setConfirm({ kind: "unfollow", pubkey: v.pubkey, name: nameFor(v.pubkey) })}
                      />
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        ) : (flagReporterCounts === null || wotLoading) ? (
          <ScanningNote />
        ) : (
          <p className="text-sm text-muted-foreground/70 py-1">No one you follow has been flagged by your network. All clear.</p>
        )}
      </Card>

      {/* ── Gone quiet ── */}
      <Card className="glass-card p-6 space-y-3" data-testid="card-gone-quiet">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Clock className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Gone quiet</h2>
            <p className="text-xs text-muted-foreground/70">Follows who haven’t posted in over 90 days.</p>
          </div>
        </div>

        {health.stagnant.length > 0 ? (
          <div>
            {health.stagnant.map((s) => (
              <HealthRow
                key={s.pubkey}
                pubkey={s.pubkey}
                subtitle={`Last posted ${formatDistanceToNow(s.lastPostAt * 1000, { addSuffix: true })}`}
                onKeep={() => markReviewed(s.pubkey)}
                onMute={() => setConfirm({ kind: "mute", pubkey: s.pubkey, name: nameFor(s.pubkey) })}
                onUnfollow={() => setConfirm({ kind: "unfollow", pubkey: s.pubkey, name: nameFor(s.pubkey) })}
              />
            ))}
          </div>
        ) : (activityScanned || followList.length === 0) ? (
          <p className="text-sm text-muted-foreground/70 py-1">Everyone you follow has posted recently. Nice and active.</p>
        ) : (
          <ScanningNote progress={activityProgress} />
        )}
      </Card>

      <ConfirmAction
        open={!!confirm}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirm?.kind === "mute" ? `Mute ${confirm?.name}?` : `Unfollow ${confirm?.name}?`}
        description={confirm?.kind === "mute"
          ? "You'll stop seeing their posts across the app. You can unmute them any time from Muted."
          : "This updates your follow list and republishes it to your relays. You can follow them again any time."}
        confirmLabel={confirm?.kind === "mute" ? "Mute" : "Unfollow"}
        variant={confirm?.kind === "mute" ? "default" : "destructive"}
        onConfirm={resolveConfirm}
      />
    </div>
  );
}
