import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { signWithTimeout } from "@/lib/signer-timeout";
import { publishEvent, fetchProfilesCached, eventStore } from "@/lib/nostr";
import { use$ } from "applesauce-react/hooks";
import {
  KIND_METADATA,
  getAvatarUrl,
  getDisplayName,
  formatNpub,
  shortenNpub,
} from "@/lib/nostr-helpers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TrustTierDot } from "@/components/NostrPost";
import { formatDistanceToNow } from "date-fns";
import {
  Bug, Lightbulb, Sparkles, HelpCircle, Inbox, RefreshCw, Filter, ExternalLink,
  CheckCircle2, XCircle, X, FileEdit, ChevronLeft, Send, ArrowUpDown, Pin, Copy, Lock, Globe,
} from "lucide-react";
import {
  type FeedbackRecipient,
  type FeedbackType,
  type FeedbackStatus,
  type FeedbackIssue,
  buildCommentTemplate,
  buildStatusTemplate,
  buildRepoAnnouncementTemplate,
  combineFeedbackIssues,
  countUnread,
  isIssueUnread,
  markIssueRead,
  markIssuesRead,
  relayScopedRepoD,
  stripContextBlock,
  renderableComments,
  sendPrivateReply,
  getAllAnnotations,
  setAnnotation,
  FEEDBACK_TOPIC_TAG,
  FEEDBACK_STATUS_LABEL,
  type CrashStatus,
  type AgeFilter,
  nextCrashStatus,
  isInactiveCrashStatus,
  isInactiveFeedbackStatus,
  matchesAge,
  sortTriaged,
  formatFilteredHeader,
  tallyFeedbackStatuses,
  tallyByAge,
  observeIssueStatuses,
} from "@/lib/nip34-feedback";
import { CRASH_SIG_TAG, isCrashIssue, groupCrashesBySig, tallyCrashStatuses, deriveCrashStatuses, issueStatusForCrashStatus } from "@/lib/crash-report";
import type { UnwrappedRumor } from "@/lib/dm";
import type { FeedbackInbox } from "@/hooks/use-feedback-inbox";
import type { Event as NostrEvent } from "nostr-tools";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import type { SignalTier } from "@/lib/graperank";

const TYPE_META: Record<FeedbackType, { label: string; icon: typeof Bug; color: string }> = {
  bug: { label: "Bug", icon: Bug, color: "border-red-400/40 text-red-700 dark:text-red-300/80" },
  idea: { label: "Idea", icon: Lightbulb, color: "border-amber-400/40 text-amber-700 dark:text-amber-300/80" },
  ux: { label: "UX", icon: Sparkles, color: "border-brand/40 text-brand dark:text-brand/80" },
  question: { label: "?", icon: HelpCircle, color: "border-blue-400/40 text-blue-700 dark:text-blue-300/80" },
};

// Colors are UI-only. The labels come from FEEDBACK_STATUS_LABEL in
// nip34-feedback so the tab, the reporter's view, and other NIP-34 clients all
// agree on what each wire kind means: open(1630)=Open, resolved(1631)=Resolved,
// closed(1632)=Closed, draft(1633)=Triaged. (Previously resolved was mislabelled
// "In progress", so a status set here read as a different status elsewhere.)
// Color semantics match the crash-status chips: needs-attention (Open=violet,
// crash New=amber) → in-motion (Triaged/Investigating=blue) → done
// (Resolved/Fixed=green, Closed/Ignored=muted).
const STATUS_META: Record<FeedbackStatus, { label: string; color: string }> = {
  open: { label: FEEDBACK_STATUS_LABEL.open, color: "border-brand/40 text-brand dark:text-brand/80 bg-brand/10" },
  draft: { label: FEEDBACK_STATUS_LABEL.draft, color: "border-blue-400/40 text-blue-700 dark:text-blue-300/80 bg-blue-500/10" },
  resolved: { label: FEEDBACK_STATUS_LABEL.resolved, color: "border-emerald-400/40 text-emerald-700 dark:text-emerald-300/80 bg-emerald-500/10" },
  closed: { label: FEEDBACK_STATUS_LABEL.closed, color: "border-muted-foreground/30 text-muted-foreground/60 bg-muted/20" },
};

// Crash triage vocabulary is a VIEW over the ticket's real NIP-34 status
// (open↔New, draft↔Investigating, resolved↔Fixed, closed↔Closed — see
// crash-report.ts mapping). Colors: New=amber (needs a look),
// Investigating=blue, Fixed=green, Closed=muted. (The "ignored" view key keeps
// its name internally, but the operator-facing label says Closed — closing a
// ticket must read back as the action the operator actually took.)
const CRASH_STATUS_META: Record<CrashStatus, { label: string; color: string }> = {
  new: { label: "New", color: "border-amber-400/40 text-amber-700 dark:text-amber-300/80 bg-amber-500/10" },
  investigating: { label: "Investigating", color: "border-blue-400/40 text-blue-700 dark:text-blue-300/80 bg-blue-500/10" },
  fixed: { label: "Fixed", color: "border-emerald-400/40 text-emerald-700 dark:text-emerald-300/80 bg-emerald-500/10" },
  ignored: { label: "Closed", color: "border-muted-foreground/30 text-muted-foreground/60 bg-muted/20" },
};

/** The status chip that lives ON a crash card / crash detail: tap cycles
 *  new → investigating → fixed → ignored. The cycle publishes a REAL ticket
 *  status change (via onCycle → the same path the Feedback detail uses), so
 *  the list, the detail, and other operator devices always agree. */
function CrashStatusChip({ sig, status, onCycle }: { sig: string; status: CrashStatus; onCycle: (next: CrashStatus) => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onCycle(nextCrashStatus(status)); }}
      className={`px-2 h-5 rounded-full border text-[10px] leading-none inline-flex items-center ${CRASH_STATUS_META[status].color}`}
      title={`Status: ${CRASH_STATUS_META[status].label} — tap to cycle`}
      aria-label={`Crash status ${CRASH_STATUS_META[status].label}, tap to change`}
      data-testid={`button-crash-status-${sig}`}
    >
      {CRASH_STATUS_META[status].label}
    </button>
  );
}

function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  const values = Array.from(a);
  for (const v of values) if (!b.has(v)) return false;
  return true;
}

function ReporterAvatar({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  useEffect(() => { fetchProfilesCached([pubkey]); }, [pubkey]);
  const name = profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey));
  const avatar = profile ? getAvatarUrl(profile) : null;
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Avatar className="w-5 h-5 border border-border/40">
        {avatar && <AvatarImage src={avatar} alt={name || ""} />}
        <AvatarFallback className="text-[10px] bg-brand/10 text-brand">
          {(name || "?").slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-[11px] truncate max-w-[120px]">{name}</span>
      <TrustTierDot pubkey={pubkey} />
    </div>
  );
}

export function FeedbackTab({ relayUrl, inbox }: { relayUrl: string; inbox: FeedbackInbox }) {
  const { signer, pubkey } = useNostrAuth();
  const { toast } = useToast();
  // Discovery + subscriptions + the combined issue list live in useFeedbackInbox
  // (owned by RelayOpsCenter and shared with the unread badge, so the two can
  // never diverge). The tab only layers its own optimistic updates + UI state.
  const { recipient, operatorPubkey, coordValue, events, privateRumors, discovering, nip44Missing, reload } = inbox;
  const [enabling, setEnabling] = useState(false);
  // The "make your inbox discoverable" nudge kept re-appearing for operators who
  // had already published the marker: the read-back that sets recipient.hasInbox
  // queries the operator's own AUTH-required relay via the non-AUTH pool, so it
  // can't see the marker it just wrote. Persist a per-relay flag on enable OR
  // dismiss so the one-time nudge stays gone once the operator has acted.
  const inboxNudgeKey = `ro_feedback_inbox_marker_done:${relayUrl}`;
  const [inboxNudgeDone, setInboxNudgeDone] = useState<boolean>(() => {
    try { return localStorage.getItem(inboxNudgeKey) === "1"; } catch { return false; }
  });
  const dismissInboxNudge = () => {
    try { localStorage.setItem(inboxNudgeKey, "1"); } catch {}
    setInboxNudgeDone(true);
  };
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<FeedbackType | "all">("all");
  const [tierFilter, setTierFilter] = useState<SignalTier | "all">("all");
  const [ageFilter, setAgeFilter] = useState<AgeFilter>("all");
  const [crashStatusFilter, setCrashStatusFilter] = useState<CrashStatus | "all">("all");
  const [crashAgeFilter, setCrashAgeFilter] = useState<AgeFilter>("all");
  const [crashRouteFilter, setCrashRouteFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [posting, setPosting] = useState(false);
  const [optimisticEvents, setOptimisticEvents] = useState<NostrEvent[]>([]);
  const [optimisticRumors, setOptimisticRumors] = useState<UnwrappedRumor[]>([]);
  const { getAuthorTier } = useGrapeRankScores();

  // The SAME combine the badge uses (combineFeedbackIssues), plus this tab's
  // optimistic layer so a reply / status change shows instantly and reconciles
  // when it round-trips (privateRumorKey dedupes the optimistic vs real copy).
  const issues = useMemo(
    () => combineFeedbackIssues([...events, ...optimisticEvents], [...privateRumors, ...optimisticRumors]),
    [events, optimisticEvents, privateRumors, optimisticRumors],
  );

  // Auto-filed anonymous crash reports (t:crash) are kept OUT of the human
  // feedback stream and shown in their own "Crashes" view, grouped by the
  // stable crash-sig so one recurring error collapses to a single "Error · N×".
  const feedbackIssues = useMemo(() => issues.filter((i) => !isCrashIssue(i)), [issues]);
  const crashIssues = useMemo(() => issues.filter(isCrashIssue), [issues]);
  const crashGroups = useMemo(() => groupCrashesBySig(crashIssues), [crashIssues]);
  const [view, setView] = useState<"feedback" | "crashes">("feedback");

  const [annotationsTick, setAnnotationsTick] = useState(0);
  useEffect(() => {
    const onChange = () => setAnnotationsTick((n) => n + 1);
    window.addEventListener("relay-outpost:feedback-annotated", onChange);
    return () => window.removeEventListener("relay-outpost:feedback-annotated", onChange);
  }, []);
  const annotations = useMemo(() => getAllAnnotations(), [annotationsTick, issues]);
  // Crash triage status = the group's latest TICKET status — one source of
  // truth with the Feedback detail, no parallel local store to drift. The
  // optimistic status layer flows through issues → crashGroups, so a chip
  // cycle or a detail status change flips the list instantly.
  const crashStatuses = useMemo(() => deriveCrashStatuses(crashGroups), [crashGroups]);

  // Distinct routes present in the current crash groups (from the parsed
  // context blocks) — lets the operator slice "all crashes on /profile".
  const crashRoutes = useMemo(
    () => Array.from(new Set(crashGroups.map((g) => g.route).filter((r): r is string => !!r))).sort(),
    [crashGroups],
  );
  useEffect(() => {
    // A selected route can disappear when groups reload — never leave an
    // invisible filter active.
    if (crashRouteFilter !== "all" && !crashRoutes.includes(crashRouteFilter)) setCrashRouteFilter("all");
  }, [crashRoutes, crashRouteFilter]);

  const filteredCrashGroups = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const matched = crashGroups.filter((g) => {
      const status = crashStatuses[g.sig] || "new";
      if (crashStatusFilter !== "all" && status !== crashStatusFilter) return false;
      if (!matchesAge(g.latest.latestActivityAt, crashAgeFilter, now)) return false;
      if (crashRouteFilter !== "all" && g.route !== crashRouteFilter) return false;
      return true;
    });
    // Fixed/Ignored sink below active groups (and render dimmed).
    return sortTriaged(matched, {
      dimmed: (g) => isInactiveCrashStatus(crashStatuses[g.sig] || "new"),
      activityAt: (g) => g.latest.latestActivityAt,
    });
  }, [crashGroups, crashStatuses, crashStatusFilter, crashAgeFilter, crashRouteFilter]);

  // "Updated" dots: ids whose status changed within the dot window, per the
  // local last-status-seen map (covers both our own changes and wire changes).
  const [recentStatusIds, setRecentStatusIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const ids = observeIssueStatuses(feedbackIssues.map((i) => ({ id: i.event.id, status: i.status })));
    setRecentStatusIds((prev) => (sameIdSet(prev, ids) ? prev : ids));
  }, [feedbackIssues]);

  // Usable recipient for building replies/status even before a repo exists.
  const effectiveRecipient: FeedbackRecipient | null = recipient
    ? recipient
    : operatorPubkey
      ? { label: relayUrl.replace(/^wss?:\/\//, ""), relay: relayUrl, operatorPubkey, repoD: null, hasInbox: false }
      : null;

  const filtered = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const matched = feedbackIssues.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (typeFilter !== "all" && !i.type.includes(typeFilter)) return false;
      if (!matchesAge(i.latestActivityAt, ageFilter, now)) return false;
      if (tierFilter !== "all") {
        const t = getAuthorTier(i.reporter);
        if (t !== tierFilter) return false;
      }
      return true;
    });
    // Pinned first, then open/triaged, then dimmed resolved/closed — newest
    // activity first within each band.
    return sortTriaged(matched, {
      pinned: (i) => !!annotations[i.event.id]?.pinned,
      dimmed: (i) => isInactiveFeedbackStatus(i.status),
      activityAt: (i) => i.latestActivityAt,
    });
  }, [feedbackIssues, statusFilter, typeFilter, tierFilter, ageFilter, getAuthorTier, annotations]);

  // Distribution behind the filter chips — so "New 5 · Investigating 0" is
  // visible and the operator can see WHY narrowing does or doesn't change the
  // list (transparency: an inert filter on a uniform dataset isn't a bug).
  const crashStatusCounts = useMemo(() => tallyCrashStatuses(crashGroups, crashStatuses), [crashGroups, crashStatuses]);
  const crashAgeCounts = useMemo(() => tallyByAge(crashGroups.map((g) => g.latest.latestActivityAt), Math.floor(Date.now() / 1000)), [crashGroups]);
  const feedbackStatusCounts = useMemo(() => tallyFeedbackStatuses(feedbackIssues), [feedbackIssues]);
  const feedbackAgeCounts = useMemo(() => tallyByAge(feedbackIssues.map((i) => i.latestActivityAt), Math.floor(Date.now() / 1000)), [feedbackIssues]);

  const crashFiltersActive = crashStatusFilter !== "all" || crashAgeFilter !== "all" || crashRouteFilter !== "all";
  const feedbackFiltersActive = statusFilter !== "all" || typeFilter !== "all" || tierFilter !== "all" || ageFilter !== "all";
  const resetCrashFilters = () => { setCrashStatusFilter("all"); setCrashAgeFilter("all"); setCrashRouteFilter("all"); };
  const resetFeedbackFilters = () => { setStatusFilter("all"); setTypeFilter("all"); setTierFilter("all"); setAgeFilter("all"); };

  const selected = useMemo(() => filtered.find((i) => i.event.id === selectedId) || issues.find((i) => i.event.id === selectedId) || null, [filtered, issues, selectedId]);

  const enableInbox = async () => {
    if (!signer || !pubkey) {
      toast({ title: "Sign in required", variant: "destructive" });
      return;
    }
    if (!recipient) return;
    setEnabling(true);
    try {
      const relayName = recipient.label || relayUrl.replace(/^wss?:\/\//, "");
      const d = relayScopedRepoD(relayUrl);
      const template = buildRepoAnnouncementTemplate({
        d,
        name: `${relayName} feedback`,
        description: `Feedback inbox for ${relayName}`,
        relay: relayUrl,
        topics: [FEEDBACK_TOPIC_TAG],
      });
      const signed = await signWithTimeout(signer, template);
      await publishEvent(signed, [relayUrl], undefined, true);
      toast({ title: "Feedback inbox enabled", description: "Operators can now receive NIP-34 feedback here." });
      dismissInboxNudge(); // stop the nudge even if the AUTH-gated read-back can't see the marker
      setTimeout(reload, 800);
    } catch (err) {
      toast({ title: "Could not enable inbox", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setEnabling(false);
    }
  };

  const postReply = async () => {
    if (!signer || !selected || !effectiveRecipient || !reply.trim() || !pubkey) return;
    setPosting(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      if (selected.private) {
        const res = await sendPrivateReply({ signer, myPubkey: pubkey, recipientPubkey: selected.reporter, issueRumorId: selected.event.id, body: reply.trim() });
        if (!res.success) throw new Error(res.error || "Send failed");
        setOptimisticRumors((prev) => [...prev, { pubkey, kind: 1111, tags: [["E", selected.event.id]], content: reply.trim(), created_at: now, id: `opt-${now}-${Math.random().toString(36).slice(2)}` }]);
      } else {
        const tpl = buildCommentTemplate({ issue: selected.event, body: reply.trim(), recipient: effectiveRecipient });
        const signed = await signWithTimeout(signer, tpl);
        // Publish to the reporter's read relays (so they receive it) + this relay.
        await publishEvent(signed, [relayUrl], selected.reporter, false);
        setOptimisticEvents((prev) => [...prev, signed as unknown as NostrEvent]);
      }
      // The operator just read + replied — keep their own reply from lighting up
      // the unread badge (it bumps latestActivityAt).
      markIssueRead(selected.event.id, now);
      setReply("");
      toast({ title: "Reply sent" });
    } catch (err) {
      toast({ title: "Could not send reply", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setPosting(false);
    }
  };

  // Publishes a REAL ticket status change for any issue — the detail buttons
  // and the crash-list chips both route through here, so every surface (and
  // every operator device) reads the same status.
  const changeStatusFor = async (issue: FeedbackIssue, status: FeedbackStatus) => {
    if (!signer || !effectiveRecipient || !pubkey) return;
    const now = Math.floor(Date.now() / 1000);
    const optId = `opt-${now}-${Math.random().toString(36).slice(2)}`;

    // OPTIMISTIC-FIRST: flip the chip and confirm the tap IMMEDIATELY, then do
    // the slow part (NIP-44 gift-wrap / sign + publish to an AUTH relay — easily
    // seconds) in the background. Awaiting the round-trip before updating made
    // every status tap feel stuck ("takes a while to register"). On failure the
    // optimistic entry is rolled back and the error surfaces.
    const isPrivate = issue.private;
    if (isPrivate) {
      // combineFeedbackIssues reads the status tag so the label flips now;
      // privateRumorKey includes the status so distinct changes don't collapse
      // and the real round-trip dedupes to one.
      setOptimisticRumors((prev) => [...prev, { pubkey, kind: 1111, tags: [["E", issue.event.id], ["status", status]], content: "", created_at: now, id: optId }]);
    } else {
      // Synthetic (unsigned) status event — hydrateIssues only reads kind + tags
      // to pick the newest status per root, so it flips the label the same way
      // the signed copy will; the real publish replaces it via the reload path.
      const tpl = buildStatusTemplate({ issue: issue.event, status, recipient: effectiveRecipient });
      setOptimisticEvents((prev) => [...prev, { ...tpl, pubkey, created_at: now, id: optId, sig: "" } as unknown as NostrEvent]);
    }
    // The operator's own status change isn't unread-for-the-operator.
    markIssueRead(issue.event.id, now);
    toast({ title: `Marked ${STATUS_META[status].label}` });

    try {
      if (isPrivate) {
        // Status-only private change: an empty-body kind-1111 rumor carrying just
        // the `status` tag. It travels as its own status-only rumor (round-trips
        // to the reporter) but renderableComments hides the empty body so it never
        // shows as a blank card.
        const res = await sendPrivateReply({ signer, myPubkey: pubkey, recipientPubkey: issue.reporter, issueRumorId: issue.event.id, body: "", statusTag: status });
        if (!res.success) throw new Error(res.error || "Send failed");
      } else {
        const tpl = buildStatusTemplate({ issue: issue.event, status, recipient: effectiveRecipient });
        const signed = await signWithTimeout(signer, tpl);
        await publishEvent(signed, [relayUrl], issue.reporter, false);
      }
    } catch (err) {
      // Roll the flip back so the UI never lies about a change that didn't stick.
      if (isPrivate) setOptimisticRumors((prev) => prev.filter((r) => r.id !== optId));
      else setOptimisticEvents((prev) => prev.filter((e) => e.id !== optId));
      toast({ title: "Could not change status", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const changeStatus = async (status: FeedbackStatus) => {
    if (selected) await changeStatusFor(selected, status);
  };

  const consoleUrl = coordValue
    ? `/console?filter=${encodeURIComponent(JSON.stringify({ kinds: [1621, 1111, 1622, 1630, 1631, 1632, 1633], "#a": [coordValue] }))}&relay=${encodeURIComponent(relayUrl)}`
    : "/console";

  if (discovering) {
    return (
      <div className="flex items-center justify-center min-h-[280px]">
        <div className="flex items-center gap-2 text-sm text-muted-foreground/60">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading feedback inbox…
        </div>
      </div>
    );
  }

  // We can only show an inbox if we can identify who the feedback is addressed to.
  if (!operatorPubkey) {
    return (
      <Card className="glass-card p-6 text-center max-w-lg mx-auto mt-6">
        <Inbox className="w-10 h-10 mx-auto text-brand/60 mb-3" />
        <h3 className="text-base font-brand uppercase tracking-widest mb-2">Feedback inbox</h3>
        <p className="text-sm text-muted-foreground/70 leading-relaxed">
          {signer
            ? "This relay doesn't publish operator info, so we can't tell who feedback should go to."
            : "Sign in as this relay's operator to see feedback from your community."}
        </p>
      </Card>
    );
  }

  if (selected) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)} data-testid="button-feedback-back">
            <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Back to inbox
          </Button>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["open", "resolved", "closed", "draft"] as FeedbackStatus[]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={selected.status === s ? "default" : "outline"}
                className="text-[10px] h-7 px-2"
                onClick={() => changeStatus(s)}
                data-testid={`button-feedback-status-${s}`}
              >
                {s === "resolved" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                {s === "closed" && <XCircle className="w-3 h-3 mr-1" />}
                {s === "draft" && <FileEdit className="w-3 h-3 mr-1" />}
                {STATUS_META[s].label}
              </Button>
            ))}
          </div>
        </div>

        <Card className="glass-card p-4">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge variant="outline" className={`text-[10px] ${STATUS_META[selected.status].color}`}>{STATUS_META[selected.status].label}</Badge>
            {selected.type.map((t) => (
              <Badge key={t} variant="outline" className={`text-[10px] ${TYPE_META[t].color}`}>{TYPE_META[t].label}</Badge>
            ))}
            <span className="text-[10px] text-muted-foreground/50 ml-auto">
              {formatDistanceToNow(selected.createdAt * 1000, { addSuffix: true })}
            </span>
          </div>
          <h3 className="text-base font-medium mb-1">{selected.title}</h3>
          <ReporterAvatar pubkey={selected.reporter} />
          {(() => {
            const annot = annotations[selected.event.id] || {};
            const crashSig = isCrashIssue(selected)
              ? (selected.event.tags.find((t) => t[0] === CRASH_SIG_TAG)?.[1] || selected.event.id)
              : null;
            return (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {crashSig && (
                  <CrashStatusChip
                    sig={crashSig}
                    status={crashStatuses[crashSig] || "new"}
                    onCycle={(next) => { if (selected) void changeStatusFor(selected, issueStatusForCrashStatus(next)); }}
                  />
                )}
                <Button
                  size="sm"
                  variant={annot.pinned ? "default" : "outline"}
                  className="text-[10px] h-6 px-2"
                  onClick={() => setAnnotation(selected.event.id, { pinned: !annot.pinned })}
                  data-testid={`button-feedback-pin-${selected.event.id.slice(0, 8)}`}
                >
                  <Pin className="w-3 h-3 mr-1" /> {annot.pinned ? "Pinned" : "Pin"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[10px] h-6 px-2"
                  onClick={() => {
                    const v = window.prompt(annot.duplicateOf ? "Duplicate of issue id (clear to remove):" : "Duplicate of issue id:", annot.duplicateOf || "");
                    if (v === null) return;
                    setAnnotation(selected.event.id, { duplicateOf: v.trim() || undefined });
                  }}
                  data-testid={`button-feedback-duplicate-${selected.event.id.slice(0, 8)}`}
                >
                  <Copy className="w-3 h-3 mr-1" /> {annot.duplicateOf ? `Duplicate of ${annot.duplicateOf.slice(0, 8)}…` : "Mark duplicate"}
                </Button>
                <span className="text-[10px] text-muted-foreground/50">Local annotations only — never published.</span>
              </div>
            );
          })()}
          <p className="text-sm whitespace-pre-wrap mt-3 text-foreground/80">{stripContextBlock(selected.event.content) || <span className="text-muted-foreground/50 italic">No additional details.</span>}</p>
          {selected.contextBlock && (
            <div className="mt-3 rounded-md border border-border/40 px-3 py-2 text-[11px] font-mono text-muted-foreground/70 space-y-0.5">
              <div>route: {selected.contextBlock.route}</div>
              <div>viewport: {selected.contextBlock.viewport}</div>
              <div>signer: {selected.contextBlock.signerType}</div>
              <div>app: {selected.contextBlock.appVersion}</div>
            </div>
          )}
        </Card>

        {(() => {
          // Empty-body status-only rumors are hidden (they update status, they're
          // not messages). Operator (you) vs reporter (them) are distinguished by
          // side + tint + role label so the thread reads as a conversation.
          const thread = renderableComments(selected.comments);
          if (thread.length === 0) return null;
          return (
            <div className="space-y-2">
              {thread.map((c) => {
                const mine = c.pubkey === pubkey || (!!operatorPubkey && c.pubkey === operatorPubkey);
                return (
                  <div key={c.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <Card className={`glass-card p-3 max-w-[85%] ${mine ? "border-primary/30 bg-primary/[0.06]" : ""}`}>
                      <div className="flex items-center justify-between gap-3 mb-1">
                        {mine
                          ? <span className="text-[11px] font-medium text-brand">You (operator)</span>
                          : <ReporterAvatar pubkey={c.pubkey} />}
                        <span className="text-[10px] text-muted-foreground/50 shrink-0">{formatDistanceToNow(c.created_at * 1000, { addSuffix: true })}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap text-foreground/80">{c.content}</p>
                    </Card>
                  </div>
                );
              })}
            </div>
          );
        })()}

        <div className="space-y-2">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Reply…"
            rows={3}
            className="text-sm"
            data-testid="textarea-feedback-reply"
          />
          <div className="flex justify-end">
            <Button onClick={postReply} disabled={posting || !reply.trim() || !signer} data-testid="button-feedback-post-reply">
              {posting ? <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-2" />}
              Reply
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const unreadCount = countUnread(coordValue || "", feedbackIssues);

  return (
    <div className="space-y-4">
      {nip44Missing && (
        <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2.5" data-testid="notice-feedback-nip44">
          <Lock className="w-3.5 h-3.5 text-amber-500/80 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-700 dark:text-amber-300/80 leading-relaxed">
            Private tickets require a NIP-44-capable signer. Your current signer can't decrypt them, so only public feedback appears below. Sign in with a NIP-44 signer (e.g. a Nostr extension like Alby or nos2x) to read private tickets.
          </p>
        </div>
      )}
      {!recipient?.hasInbox && !inboxNudgeDone && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-xs font-medium">Make your inbox discoverable</p>
            <p className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
              You're already receiving feedback below. Publishing a one-time inbox marker also lets other Nostr apps route feedback here.
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="outline" className="text-[10px] h-7" onClick={enableInbox} disabled={enabling || !signer} data-testid="button-enable-feedback-inbox">
              {enabling ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <Inbox className="w-3 h-3 mr-1" />}
              Enable
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground/50 hover:text-foreground" onClick={dismissInboxNudge} aria-label="Dismiss" title="Dismiss" data-testid="button-dismiss-feedback-inbox">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
          <Inbox className="w-4 h-4" />
          {view === "feedback"
            ? <span data-testid="text-feedback-header-count">{formatFilteredHeader("issue", filtered.length, feedbackIssues.length)}</span>
            : (
              <span data-testid="text-crash-header-count">
                {formatFilteredHeader("error", filteredCrashGroups.length, crashGroups.length)}
                {filteredCrashGroups.length >= crashGroups.length ? ` · ${crashIssues.length} total` : ""}
              </span>
            )}
          {view === "feedback" && unreadCount > 0 && (
            <Badge variant="outline" className="text-[10px] border-brand/40 text-brand bg-brand/10">{unreadCount} new</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {view === "feedback" && unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markIssuesRead(feedbackIssues)} data-testid="button-feedback-mark-all-read">
              <CheckCircle2 className="w-3 h-3 mr-1" /> Mark all read
            </Button>
          )}
          <a href={consoleUrl} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground/60 hover:text-brand inline-flex items-center gap-1" data-testid="link-feedback-console">
            View in Event Console <ExternalLink className="w-3 h-3" />
          </a>
          <Button variant="ghost" size="sm" onClick={reload} data-testid="button-feedback-refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1" data-testid="feedback-view-toggle">
        {([
          { id: "feedback", label: `Feedback${feedbackIssues.length ? ` · ${feedbackIssues.length}` : ""}` },
          { id: "crashes", label: `Crashes${crashGroups.length ? ` · ${crashGroups.length}` : ""}` },
        ] as const).map((v) => (
          <button
            key={v.id}
            onClick={() => { setSelectedId(null); setView(v.id); }}
            className={`px-2.5 py-1 rounded text-[11px] border ${view === v.id ? "border-brand/30 bg-accent text-accent-foreground dark:text-brand" : "border-transparent text-muted-foreground/60 hover:text-foreground"}`}
            data-testid={`button-feedback-view-${v.id}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "feedback" && (
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <Filter className="w-3 h-3 text-muted-foreground/50" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50">Status</span>
          {(["all", "open", "resolved", "closed", "draft"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2 py-0.5 rounded text-[10px] border ${statusFilter === s ? "border-brand/20 bg-accent text-accent-foreground dark:text-brand" : "border-transparent text-muted-foreground/60 hover:text-foreground"}`}
              data-testid={`button-feedback-filter-status-${s}`}
            >
              {s === "all" ? "All" : STATUS_META[s as FeedbackStatus].label}
              <span className="ml-1 tabular-nums text-[9px] opacity-60">{s === "all" ? feedbackIssues.length : feedbackStatusCounts[s as FeedbackStatus]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50">Type</span>
          {(["all", "bug", "idea", "ux", "question"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2 py-0.5 rounded text-[10px] border ${typeFilter === t ? "border-brand/20 bg-accent text-accent-foreground dark:text-brand" : "border-transparent text-muted-foreground/60 hover:text-foreground"}`}
              data-testid={`button-feedback-filter-type-${t}`}
            >
              {t === "all" ? "All" : TYPE_META[t as FeedbackType].label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50">Trust</span>
          {(["all", "strong", "moderate", "low", "weak", "flagged"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTierFilter(t)}
              className={`px-2 py-0.5 rounded text-[10px] border capitalize ${tierFilter === t ? "border-brand/20 bg-accent text-accent-foreground dark:text-brand" : "border-transparent text-muted-foreground/60 hover:text-foreground"}`}
              data-testid={`button-feedback-filter-tier-${t}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50">Age</span>
          {([
            { id: "all", label: "All" },
            { id: "24h", label: "24h" },
            { id: "7d", label: "7d" },
            { id: "30d", label: "30d" },
          ] as const).map((a) => (
            <button
              key={a.id}
              onClick={() => setAgeFilter(a.id)}
              className={`px-2 py-0.5 rounded text-[10px] border ${ageFilter === a.id ? "border-brand/20 bg-accent text-accent-foreground dark:text-brand" : "border-transparent text-muted-foreground/60 hover:text-foreground"}`}
              data-testid={`button-feedback-filter-age-${a.id}`}
            >
              {a.label}
              <span className="ml-1 tabular-nums text-[9px] opacity-60">{feedbackAgeCounts[a.id]}</span>
            </button>
          ))}
        </div>
        {feedbackFiltersActive && (
          <button
            onClick={resetFeedbackFilters}
            className="px-2 py-0.5 rounded text-[10px] border border-transparent text-brand hover:bg-accent inline-flex items-center gap-1"
            data-testid="button-feedback-filter-reset"
          >
            <XCircle className="w-2.5 h-2.5" /> Clear
          </button>
        )}
      </div>
      )}

      {view === "crashes" && (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Filter className="w-3 h-3 text-muted-foreground/50" />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50">Status</span>
            {(["all", "new", "investigating", "fixed", "ignored"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setCrashStatusFilter(s)}
                className={`px-2 py-0.5 rounded text-[10px] border ${crashStatusFilter === s ? "border-brand/20 bg-accent text-accent-foreground dark:text-brand" : "border-transparent text-muted-foreground/60 hover:text-foreground"}`}
                data-testid={`button-crash-filter-status-${s}`}
              >
                {s === "all" ? "All" : CRASH_STATUS_META[s as CrashStatus].label}
                <span className="ml-1 tabular-nums text-[9px] opacity-60">{s === "all" ? crashGroups.length : crashStatusCounts[s as CrashStatus]}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50">Age</span>
            {([
              { id: "all", label: "All" },
              { id: "24h", label: "24h" },
              { id: "7d", label: "7d" },
              { id: "30d", label: "30d" },
            ] as const).map((a) => (
              <button
                key={a.id}
                onClick={() => setCrashAgeFilter(a.id)}
                className={`px-2 py-0.5 rounded text-[10px] border ${crashAgeFilter === a.id ? "border-brand/20 bg-accent text-accent-foreground dark:text-brand" : "border-transparent text-muted-foreground/60 hover:text-foreground"}`}
                data-testid={`button-crash-filter-age-${a.id}`}
              >
                {a.label}
                <span className="ml-1 tabular-nums text-[9px] opacity-60">{crashAgeCounts[a.id]}</span>
              </button>
            ))}
          </div>
          {crashFiltersActive && (
            <button
              onClick={resetCrashFilters}
              className="px-2 py-0.5 rounded text-[10px] border border-transparent text-brand hover:bg-accent inline-flex items-center gap-1"
              data-testid="button-crash-filter-reset"
            >
              <XCircle className="w-2.5 h-2.5" /> Clear
            </button>
          )}
          {crashRoutes.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50">Route</span>
              <select
                value={crashRouteFilter}
                onChange={(e) => setCrashRouteFilter(e.target.value)}
                className={`h-6 max-w-[160px] rounded border bg-transparent px-1 text-[10px] ${crashRouteFilter !== "all" ? "border-brand/30 text-accent-foreground dark:text-brand" : "border-border/40 text-muted-foreground/70"}`}
                data-testid="select-crash-filter-route"
              >
                <option value="all">All routes</option>
                {crashRoutes.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/50">Statuses are real ticket statuses — tap a chip to cycle; changes sync to your other operator devices.</p>
      </div>
      )}

      {view === "crashes" ? (
        crashGroups.length === 0 ? (
          <Card className="glass-card p-6 text-center">
            <p className="text-sm text-muted-foreground/60">No crash reports yet. Anonymous crash tickets from users' error screens land here.</p>
          </Card>
        ) : filteredCrashGroups.length === 0 ? (
          <Card className="glass-card p-6 text-center">
            <p className="text-sm text-muted-foreground/60">No crashes match these filters.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredCrashGroups.map((g) => {
              const i = g.latest;
              const crashStatus = crashStatuses[g.sig] || "new";
              const dimmed = isInactiveCrashStatus(crashStatus);
              return (
                <Card
                  key={g.sig}
                  className={`glass-card p-3 cursor-pointer hover:border-primary/40 transition-colors ${dimmed ? "opacity-60" : ""}`}
                  onClick={() => { markIssueRead(i.event.id, i.latestActivityAt); setSelectedId(i.event.id); }}
                  data-testid={`card-crash-group-${g.sig}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="text-[10px] border-red-400/40 text-red-700 dark:text-red-300/80 inline-flex items-center"><Bug className="w-2.5 h-2.5 mr-1" />Crash</Badge>
                        <CrashStatusChip
                          sig={g.sig}
                          status={crashStatus}
                          onCycle={(next) => void changeStatusFor(g.latest, issueStatusForCrashStatus(next))}
                        />
                        <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground/70" data-testid={`badge-crash-count-${g.sig}`}>{g.count}×</Badge>
                        {i.private && <Lock className="w-3 h-3 text-brand/70" aria-label="Private" />}
                      </div>
                      <h4 className="text-sm font-medium mt-1 truncate">{i.title}</h4>
                      <p className="text-[11px] text-muted-foreground/60 line-clamp-1 mt-0.5">{i.event.content.split("\n")[0]}</p>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span className="text-[10px] text-muted-foreground/50">last seen {formatDistanceToNow(i.latestActivityAt * 1000, { addSuffix: true })}</span>
                        {g.route && <span className="text-[10px] text-muted-foreground/50 font-mono truncate max-w-[140px]">{g.route}</span>}
                        <span className="text-[10px] text-muted-foreground/40 font-mono">{g.sig}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      ) : filtered.length === 0 ? (
        <Card className="glass-card p-6 text-center">
          <p className="text-sm text-muted-foreground/60">{feedbackIssues.length === 0 ? "No feedback yet. Share the Send feedback link with your users." : "No issues match these filters."}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((i) => {
            const unread = isIssueUnread(i);
            const replyCount = renderableComments(i.comments).length;
            const dimmed = isInactiveFeedbackStatus(i.status);
            return (
              <Card
                key={i.event.id}
                className={`glass-card p-3 cursor-pointer hover:border-primary/40 transition-colors ${unread ? "border-primary/30" : ""} ${dimmed ? "opacity-60" : ""}`}
                onClick={() => { markIssueRead(i.event.id, i.latestActivityAt); setSelectedId(i.event.id); }}
                data-testid={`card-feedback-issue-${i.event.id.slice(0, 8)}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {i.private
                        ? <Lock className="w-3 h-3 text-brand/70" aria-label="Private" data-testid={`icon-private-${i.event.id.slice(0, 8)}`} />
                        : <Globe className="w-3 h-3 text-muted-foreground/50" aria-label="Public" data-testid={`icon-public-${i.event.id.slice(0, 8)}`} />}
                      <Badge variant="outline" className={`text-[10px] ${STATUS_META[i.status].color}`}>{STATUS_META[i.status].label}</Badge>
                      {recentStatusIds.has(i.event.id) && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-sky-400/80"
                          title="Status changed recently"
                          aria-label="Status changed recently"
                          data-testid={`dot-feedback-status-updated-${i.event.id.slice(0, 8)}`}
                        />
                      )}
                      {i.type.map((t) => (
                        <Badge key={t} variant="outline" className={`text-[10px] ${TYPE_META[t].color}`}>{TYPE_META[t].label}</Badge>
                      ))}
                      {unread && <span className="w-1.5 h-1.5 rounded-full bg-primary" data-testid={`dot-feedback-unread-${i.event.id.slice(0, 8)}`} />}
                    </div>
                    <h4 className="text-sm font-medium mt-1 truncate">{i.title}</h4>
                    <p className="text-[11px] text-muted-foreground/60 line-clamp-1 mt-0.5">{i.event.content.split("\n")[0]}</p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <ReporterAvatar pubkey={i.reporter} />
                      <span className="text-[10px] text-muted-foreground/50">
                        {formatDistanceToNow(i.createdAt * 1000, { addSuffix: true })}
                      </span>
                      {replyCount > 0 && (
                        <span className="text-[10px] text-muted-foreground/50 inline-flex items-center gap-1">
                          <ArrowUpDown className="w-2.5 h-2.5" />{replyCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
