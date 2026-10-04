/**
 * Relays › Inbox — everything waiting on you for this relay, in one place
 * (owner, 2026-10-03): reports, join requests and feedback.
 *
 * Reports come first and are ordered by trust: reports someone in your
 * network made sit on top; the rest fold into "From people you don't know" —
 * counted and one tap away, never hidden. Join requests and reports inside
 * this relay's groups are the same rows Activity shows (one sweep, so the two
 * can't disagree). Feedback is the relay's support inbox.
 *
 * The relay's own "moderation queue" (NIP-86 listeventsneedingmoderation) is
 * deliberately not here: relay.tools answers it with an empty list whatever
 * is waiting, and an Inbox that says "all clear" because nobody checked is the
 * confident-empty this project keeps removing.
 */
import { isCrashIssue } from "@/lib/crash-report";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools";
import { ChevronDown, Eye, Ban, Trash2, Check, ScanSearch } from "lucide-react";
import { EventInspector, type InspectedEvent } from "./EventInspector";
import { pool } from "@/lib/nostr";
import { supportsNip, type Nip11Document } from "@/lib/nip11";
import { banPubkey, fetchRelayCapabilities, removeEventByAction } from "@/lib/nip86";
import { canDo, UNKNOWN_CAPABILITIES, type RelayCapabilities } from "@/lib/relay-capabilities";
import { runBatch } from "@/lib/relay-moderation";
import { describeReport, reportKey, splitByTrust, type RelayReport } from "@/lib/relay-reports";
import { reportsFor } from "@/hooks/use-relay-reports-queue";
import { getTrustPhrase } from "@/lib/trust-words";
import { useNeedsYou } from "@/contexts/NeedsYouContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { useToast } from "@/hooks/use-toast";
import type { FeedbackInbox } from "@/hooks/use-feedback-inbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AdmissionQueue } from "@/components/AdmissionQueue";
import { ReportsQueue } from "@/components/ReportsQueue";
import { FeedbackTab } from "./FeedbackTab";
import { ConfirmAction, type PendingAction } from "./ConfirmAction";
import { addModLogEntry, pubkeyToNpub, resolveProfileBatch, type ProfileInfo } from "./shared";
import { rowPreview } from "./content-model";

type InboxView = "all" | "reports" | "requests" | "feedback" | "errors";

function ago(sec: number): string {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export function InboxTab({ relayUrl, nip11, inbox, onSeePost, onOpenMemberInbox }: {
  relayUrl: string;
  nip11: Nip11Document | null;
  inbox: FeedbackInbox;
  /** Opens Content on this post. */
  onSeePost: (eventId: string) => void;
  /** Settings › Member inbox — where the inbox is turned on and request types are set. */
  onOpenMemberInbox?: () => void;
}) {
  const { toast } = useToast();
  const needsYou = useNeedsYou();
  const { getAuthorTier, isAuthorFlagged, wotEnabled, wotReady } = useGrapeRankScores();
  const tierOf = useCallback((pk: string) => (isAuthorFlagged(pk) ? "flagged" as const : getAuthorTier(pk)), [getAuthorTier, isAuthorFlagged]);
  const relayName = nip11?.name?.trim() || relayUrl.replace(/^wss?:\/\//, "");
  const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();

  const [caps, setCaps] = useState<RelayCapabilities>(UNKNOWN_CAPABILITIES);
  useEffect(() => {
    let off = false;
    fetchRelayCapabilities(relayUrl).then((c) => { if (!off) setCaps(c); });
    return () => { off = true; };
  }, [relayUrl]);
  const speaks86 = !!nip11 && supportsNip(nip11, 86);
  const canRemove = speaks86 && canDo(caps, "removeEvent");
  const canBan = speaks86 && canDo(caps, "ban");

  // ---- what's waiting ----
  const relayReports = reportsFor(needsYou?.relayReports, relayUrl);
  const unreached = (needsYou?.relayReports.unreached ?? []).some((u) => norm(u) === norm(relayUrl));
  const sweeping = needsYou?.relayReports.loading ?? true;
  const groupReports = (needsYou?.reports.queue ?? []).filter((r) => norm(r.relayUrl) === norm(relayUrl)).length;
  const requests = (needsYou?.admissions.queue ?? []).filter((r) => norm(r.relayUrl) === norm(relayUrl)).length;
  const feedback = inbox.unreadCount;
  const hasAppErrors = inbox.issues.some(isCrashIssue);
  const reportCount = relayReports.length + groupReports;
  const { known, strangers } = useMemo(() => splitByTrust(relayReports, tierOf, wotEnabled && wotReady), [relayReports, tierOf, wotEnabled, wotReady]);

  // Names, faces and the reported posts themselves.
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const [posts, setPosts] = useState<Map<string, NostrEvent>>(new Map());
  useEffect(() => {
    const pks = [...new Set(relayReports.flatMap((r) => [r.targetPubkey, ...r.reporters.slice(0, 3)]))].filter((pk) => !profiles.has(pk));
    if (pks.length) resolveProfileBatch(pks).then((m) => setProfiles((prev) => { const n = new Map(prev); m.forEach((v, k) => n.set(k, v)); return n; })).catch(() => {});
    const ids = relayReports.map((r) => r.targetEventId).filter((id): id is string => !!id && !posts.has(id));
    if (ids.length) {
      pool.querySync([relayUrl], { ids: ids.slice(0, 100) }, { maxWait: 5000 } as never)
        .then((evs) => setPosts((prev) => { const n = new Map(prev); evs.forEach((e) => n.set(e.id, e)); return n; }))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayReports, relayUrl]);

  const [view, setView] = useState<InboxView>("all");
  const [inspecting, setInspecting] = useState<InspectedEvent | null>(null);

  // ---- acting ----
  const [pending, setPending] = useState<(PendingAction & { report: RelayReport }) | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const dismiss = useCallback((r: RelayReport) => needsYou?.relayReports.dismiss(relayUrl, r), [needsYou, relayUrl]);
  const carryOut = useCallback(async (reason: string | undefined) => {
    if (!pending) return;
    const { report } = pending;
    const items = pending.kind === "remove" ? pending.ids : pending.pubkeys;
    setProgress({ done: 0, total: items.length });
    const out = await runBatch(items, (id) => (pending.kind === "remove" ? removeEventByAction(relayUrl, id, reason) : banPubkey(relayUrl, id, reason)));
    setProgress(null);
    setPending(null);
    if (!out.done.length) {
      toast({ title: "The relay turned this down", description: out.stopped ?? out.failed[0]?.error, variant: "destructive" });
      return;
    }
    if (pending.kind === "remove") addModLogEntry(relayUrl, { action: "delete_event", targetEventId: out.done[0], targetPubkey: report.targetPubkey, note: reason });
    else addModLogEntry(relayUrl, { action: "block_author", targetPubkey: out.done[0], note: reason });
    dismiss(report);
    toast({ title: pending.kind === "remove" ? `Removed the post from ${relayName}` : `Banned them from ${relayName}`, description: "The report is handled." });
  }, [pending, relayUrl, relayName, toast, dismiss]);

  const nameOf = (pk: string) => profiles.get(pk)?.name;
  const reportRow = (r: RelayReport) => {
    const who = profiles.get(r.targetPubkey);
    const whoName = who?.name || `${pubkeyToNpub(r.targetPubkey).slice(0, 14)}…`;
    const post = r.targetEventId ? posts.get(r.targetEventId) : undefined;
    const knownReporter = r.reporters.find((pk) => ["strong", "moderate"].includes(tierOf(pk)));
    const by = knownReporter ? (profiles.get(knownReporter)?.name ?? "Someone") : null;
    return (
      <li key={reportKey(r)} className="px-3.5 py-3 space-y-2" data-testid="ops-inbox-report" data-key={reportKey(r)}>
        <div className="flex items-start gap-3">
          <Avatar className="w-9 h-9 shrink-0">{who?.picture && <AvatarImage src={who.picture} alt="" />}<AvatarFallback className="bg-brand/10 text-brand text-[12px]">{whoName.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] leading-snug">
              <span className="font-medium">{whoName}</span>
              <span className={r.severity === "severe" ? " text-red-600 dark:text-red-400" : " text-muted-foreground"}> · {describeReport(r)}</span>
            </p>
            {post && <p className="mt-1 text-[14px] leading-snug text-foreground/85 line-clamp-2" data-testid="ops-inbox-report-post">{rowPreview(post)}</p>}
            <p className="mt-1 text-[12px] text-muted-foreground">
              {by ? <>{by}{r.reporters.length > 1 ? ` and ${r.reporters.length - 1} more` : ""} · {getTrustPhrase(tierOf(knownReporter!))} · </> : null}
              {ago(r.lastAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 pl-12">
          {r.targetEventId && <Button size="sm" variant="ghost" className="min-h-[44px] px-3 text-[13px]" onClick={() => onSeePost(r.targetEventId!)} data-testid="ops-inbox-see"><Eye className="w-4 h-4 mr-1.5" />See it</Button>}
          {post && <Button size="sm" variant="ghost" className="min-h-[44px] px-3 text-[13px]" onClick={() => setInspecting(post)} data-testid="ops-inbox-inspect"><ScanSearch className="w-4 h-4 mr-1.5" />Inspect</Button>}
          {r.targetEventId && canRemove && <Button size="sm" variant="ghost" className="min-h-[44px] px-3 text-[13px] text-red-600 dark:text-red-400" onClick={() => setPending({ kind: "remove", ids: [r.targetEventId!], rule: false, report: r })} data-testid="ops-inbox-remove"><Trash2 className="w-4 h-4 mr-1.5" />Remove post</Button>}
          {canBan && <Button size="sm" variant="ghost" className="min-h-[44px] px-3 text-[13px]" onClick={() => setPending({ kind: "ban", pubkeys: [r.targetPubkey], rule: false, report: r })} data-testid="ops-inbox-ban"><Ban className="w-4 h-4 mr-1.5" />Ban {who?.name ?? "them"}</Button>}
          <Button size="sm" variant="ghost" className="min-h-[44px] px-3 text-[13px] text-muted-foreground" onClick={() => dismiss(r)} data-testid="ops-inbox-dismiss"><Check className="w-4 h-4 mr-1.5" />Nothing to do</Button>
        </div>
      </li>
    );
  };

  const chip = (id: InboxView, label: string, n?: number) => (
    <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} data-testid={`ops-inbox-view-${id}`}
      className={`shrink-0 h-11 sm:h-9 px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${view === id ? "bg-foreground text-background" : "bg-black/[0.05] dark:bg-white/[0.06] text-foreground/80 hover:bg-black/[0.08] dark:hover:bg-white/[0.1]"}`}>
      {label}{n ? <span className="ml-1.5 tabular-nums opacity-60">{n}</span> : null}
    </button>
  );

  const showReports = view === "all" || view === "reports";
  const showRequests = view === "all" || view === "requests";
  const showFeedback = view === "all" || view === "feedback";
  const nothing = !sweeping && !unreached && reportCount === 0 && requests === 0;

  return (
    <div className="space-y-4" data-testid="ops-inbox">
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0" role="tablist" aria-label="What to show">
        {chip("all", "Everything")}
        {chip("reports", "Reports", reportCount)}
        {chip("requests", "Join requests", requests)}
        {chip("feedback", "Feedback", feedback)}
        {/* App errors only ever reach the Relay Outpost team; the chip shows when there are any. */}
        {hasAppErrors && chip("errors", "App errors", inbox.newAppErrors)}
      </div>

      {showReports && (
        <section className="space-y-2" aria-label="Reports">
          {unreached && (
            <p className="px-1 text-[13px] text-amber-700 dark:text-amber-300" data-testid="ops-inbox-unreached">
              We couldn't reach this relay to check for reports. They may be waiting.
            </p>
          )}
          {sweeping && relayReports.length === 0 && <p className="px-1 text-[13px] text-muted-foreground">Looking for reports…</p>}
          {known.length > 0 && (
            <ul className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06]" data-testid="ops-inbox-reports-known">
              {known.map(reportRow)}
            </ul>
          )}
          {strangers.length > 0 && (
            <Collapsible defaultOpen={known.length === 0 && strangers.length <= 3}>
              <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 min-h-[44px] px-3.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] text-[14px] font-medium" data-testid="ops-inbox-strangers">
                <span>From people you don't know <span className="tabular-nums text-muted-foreground">{strangers.length}</span></span>
                <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-2 rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06]" data-testid="ops-inbox-reports-strangers">
                  {strangers.map(reportRow)}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          )}
          <ReportsQueue relayUrl={relayUrl} />
        </section>
      )}

      {showRequests && <AdmissionQueue relayUrl={relayUrl} />}

      {nothing && view !== "feedback" && view !== "errors" && (
        <p className="py-6 text-center text-sm text-muted-foreground" data-testid="ops-inbox-clear">
          No reports or join requests are waiting on {relayName}.
        </p>
      )}

      {showFeedback && (
        <section aria-label="Feedback" className="space-y-2">
          {view === "all" && <h3 className="px-1 text-[13px] font-medium text-muted-foreground">Feedback</h3>}
          <FeedbackTab relayUrl={relayUrl} inbox={inbox} onOpenMemberInbox={onOpenMemberInbox} />
        </section>
      )}

      {view === "errors" && (
        <section aria-label="App errors">
          <FeedbackTab relayUrl={relayUrl} inbox={inbox} mode="errors" />
        </section>
      )}

      {pending && (
        <ConfirmAction pending={pending} relayName={relayName} canRestore={canDo(caps, "restoreEvent")} progress={progress}
          onCancel={() => { if (!progress) setPending(null); }} onConfirm={carryOut} nameOf={nameOf} />
      )}
      <EventInspector event={inspecting} relayUrl={relayUrl} relayName={relayName} onClose={() => setInspecting(null)} />
    </div>
  );
}

export default InboxTab;
