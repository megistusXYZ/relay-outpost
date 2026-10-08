/**
 * Inbox › Feedback and Inbox › App errors — what members write to the
 * operator, and the app's own error reports (only the team gets those).
 *
 * Owner, 2026-10-03: "make sure this is working correctly and is easy to use
 * and understand for relay operators and also users". The list reads like
 * Reports: one plain row per ticket, its status as a coloured word, "New"
 * when someone else has written since you looked. Three views — Needs you,
 * All, Done — and one Filter. A ticket opens to its conversation, one status
 * control and a reply box with saved replies. What counts as new, who may
 * change a status and which relay a ticket is about live in
 * lib/feedback-needs.ts, shared with the badge.
 */
import { templateLabelFor } from "@/lib/inbox-settings";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import { formatDistanceToNow } from "date-fns";
import { ChevronLeft, Lock, RefreshCw, SlidersHorizontal, Send, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { signWithTimeout } from "@/lib/signer-timeout";
import { publishEvent, fetchProfilesCached, eventStore } from "@/lib/nostr";
import { getWriteRelays } from "@/lib/outbox";
import { KIND_METADATA, getAvatarUrl, getDisplayName, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { getTrustPhrase } from "@/lib/trust-words";
import {
  type AgeFilter,
  type FeedbackIssue,
  type FeedbackRecipient,
  type FeedbackStatus,
  type FeedbackType,
  buildCommentTemplate,
  buildStatusTemplate,
  combineFeedbackIssues,
  getIssueLastRead,
  markIssueRead,
  markIssuesRead,
  sendPrivateReply,
  statusLabel,
  stripContextBlock,
} from "@/lib/nip34-feedback";
import { CRASH_SIG_TAG, deriveCrashStatuses, groupCrashesBySig, isCrashIssue, issueStatusForCrashStatus, type CrashGroup } from "@/lib/crash-report";
import {
  feedbackView,
  hasNewFromOthers,
  markAppErrorGroupRead,
  operatorInbox,
  threadItems,
  type FeedbackFilter,
  type FeedbackViewId,
} from "@/lib/feedback-needs";
import { loadSavedReplies, saveSavedReplies, STARTER_REPLIES, type SavedReply } from "@/lib/saved-replies";
import type { UnwrappedRumor } from "@/lib/dm";
import type { FeedbackInbox } from "@/hooks/use-feedback-inbox";

const STATUSES: FeedbackStatus[] = ["open", "draft", "resolved", "closed"];
const STATUS_TONE: Record<FeedbackStatus, string> = {
  open: "text-success dark:text-emerald-400",
  draft: "text-amber-700 dark:text-amber-400",
  resolved: "text-sky-700 dark:text-sky-400",
  closed: "text-muted-foreground",
};
/** What members picked when they wrote — in words, not codes. */
const KIND_WORD: Record<FeedbackType, string> = { bug: "Problem", idea: "Idea", ux: "Design", question: "Question" };
/** App errors use the same four statuses underneath, in their own words. */
const ERROR_WORD: Record<FeedbackStatus, string> = { open: "New", draft: "Looking into it", resolved: "Fixed", closed: "Ignored" };
const WHEN: { id: AgeFilter; label: string }[] = [
  { id: "all", label: "Any time" }, { id: "24h", label: "Last 24 hours" }, { id: "7d", label: "Last 7 days" }, { id: "30d", label: "Last 30 days" },
];

function ago(sec: number) {
  return formatDistanceToNow(sec * 1000, { addSuffix: true });
}

function usePerson(pubkey: string) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  useEffect(() => { fetchProfilesCached([pubkey]); }, [pubkey]);
  return { name: profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey)), picture: profile ? getAvatarUrl(profile) : null };
}

function PersonFace({ pubkey, size = "w-9 h-9" }: { pubkey: string; size?: string }) {
  const { name, picture } = usePerson(pubkey);
  return (
    <Avatar className={`${size} shrink-0`}>
      {picture && <AvatarImage src={picture} alt="" />}
      <AvatarFallback className="bg-brand/10 text-brand text-[12px]">{(name || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

function PersonName({ pubkey }: { pubkey: string }) {
  return <>{usePerson(pubkey).name}</>;
}

// ---- saved replies, loaded once and kept in step with the relay copy ----
function useSavedReplies() {
  const { signer, pubkey } = useNostrAuth();
  const [replies, setReplies] = useState<SavedReply[]>(STARTER_REPLIES);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!signer || !pubkey) return;
    let live = true;
    loadSavedReplies(signer as never, pubkey, getWriteRelays(pubkey))
      .then((r) => { if (live) { setReplies(r.replies); setLoaded(true); } })
      .catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [signer, pubkey]);
  const save = useCallback(async (next: SavedReply[]) => {
    // Never before the read: publishing then would replace a list we never saw.
    if (!signer || !pubkey || !loaded) throw new Error("Still loading your saved replies — try again in a moment.");
    await saveSavedReplies(signer as never, pubkey, getWriteRelays(pubkey), next);
    setReplies(next);
  }, [signer, pubkey, loaded]);
  return { replies, loaded, save };
}

export function FeedbackTab({ relayUrl, inbox, mode = "feedback", onOpenMemberInbox }: { relayUrl: string; inbox: FeedbackInbox; mode?: "feedback" | "errors"; onOpenMemberInbox?: () => void }) {
  const { signer, pubkey } = useNostrAuth();
  const { toast } = useToast();
  const { recipient, operatorPubkey, events, privateRumors, discovering, nip44Missing, reload, untiedIds } = inbox;
  const { getAuthorTier, isAuthorFlagged, wotEnabled } = useGrapeRankScores();
  const relayName = recipient?.label || relayUrl.replace(/^wss?:\/\//, "");

  const [view, setView] = useState<FeedbackViewId>("needs");
  const [filter, setFilter] = useState<{ types: FeedbackType[]; trustedOnly: boolean; when: AgeFilter }>({ types: [], trustedOnly: false, when: "all" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [posting, setPosting] = useState(false);
  const [optimisticEvents, setOptimisticEvents] = useState<NostrEvent[]>([]);
  const [optimisticRumors, setOptimisticRumors] = useState<UnwrappedRumor[]>([]);
  const [, setReadTick] = useState(0);
  useEffect(() => {
    const onRead = () => setReadTick((n) => n + 1);
    window.addEventListener("relay-outpost:feedback-read", onRead);
    return () => window.removeEventListener("relay-outpost:feedback-read", onRead);
  }, []);

  // The badge's list (same scoping), plus this screen's instant updates so a
  // reply or status change shows at once and reconciles when it comes back.
  const issues = useMemo(
    () => operatorInbox(combineFeedbackIssues([...events, ...optimisticEvents], [...privateRumors, ...optimisticRumors]), pubkey ?? null, relayUrl).issues,
    [events, optimisticEvents, privateRumors, optimisticRumors, pubkey, relayUrl],
  );
  const crashIssues = useMemo(() => issues.filter(isCrashIssue), [issues]);
  const crashGroups = useMemo(() => groupCrashesBySig(crashIssues), [crashIssues]);

  const trusted = (pk: string) => !isAuthorFlagged(pk) && ["strong", "moderate"].includes(getAuthorTier(pk));
  const fFilter: FeedbackFilter = { types: filter.types, trusted: filter.trustedOnly ? trusted : undefined, when: filter.when };
  const now = Math.floor(Date.now() / 1000);
  const { items, counts } = feedbackView(issues, pubkey ?? null, view, fFilter, now);
  const filterOn = filter.types.length > 0 || filter.trustedOnly || filter.when !== "all";

  const effectiveRecipient: FeedbackRecipient | null = recipient
    ?? (operatorPubkey ? { label: relayName, relay: relayUrl, operatorPubkey, repoD: null, hasInbox: false } : null);

  const selected = useMemo(() => issues.find((i) => i.event.id === selectedId) ?? null, [issues, selectedId]);
  const open = (t: FeedbackIssue) => {
    if (isCrashIssue(t)) markAppErrorGroupRead(issues, t.event.tags.find((x) => x[0] === CRASH_SIG_TAG)?.[1] || t.event.id);
    else markIssueRead(t.event.id, Math.max(t.latestActivityAt, now));
    setSelectedId(t.event.id);
    setReply("");
  };

  const postReply = async (text = reply) => {
    if (!signer || !selected || !effectiveRecipient || !text.trim() || !pubkey) return;
    setPosting(true);
    try {
      const at = Math.floor(Date.now() / 1000);
      if (selected.private) {
        const res = await sendPrivateReply({ signer, myPubkey: pubkey, recipientPubkey: selected.reporter, issueRumorId: selected.event.id, body: text.trim() });
        if (!res.success) throw new Error(res.error || "Send failed");
        setOptimisticRumors((prev) => [...prev, { pubkey, kind: 1111, tags: [["E", selected.event.id]], content: text.trim(), created_at: at, id: `opt-${at}-${Math.random().toString(36).slice(2)}` } as UnwrappedRumor]);
      } else {
        const signed = await signWithTimeout(signer, buildCommentTemplate({ issue: selected.event, body: text.trim(), recipient: effectiveRecipient }));
        await publishEvent(signed, [relayUrl], selected.reporter, false);
        setOptimisticEvents((prev) => [...prev, signed as unknown as NostrEvent]);
      }
      markIssueRead(selected.event.id, at);
      setReply("");
      toast({ title: "Reply sent", description: selected.private ? "Only they can read it." : undefined });
    } catch (err) {
      toast({ title: "Couldn't send the reply", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setPosting(false);
    }
  };

  // A real status change — published, so the reporter and every operator device see it.
  const changeStatus = async (issue: FeedbackIssue, status: FeedbackStatus) => {
    if (!signer || !effectiveRecipient || !pubkey || issue.status === status) return;
    const at = Math.floor(Date.now() / 1000);
    const optId = `opt-${at}-${Math.random().toString(36).slice(2)}`;
    if (issue.private) {
      setOptimisticRumors((prev) => [...prev, { pubkey, kind: 1111, tags: [["E", issue.event.id], ["status", status], ["p", issue.reporter]], content: "", created_at: at, id: optId } as UnwrappedRumor]);
    } else {
      const tpl = buildStatusTemplate({ issue: issue.event, status, recipient: effectiveRecipient });
      setOptimisticEvents((prev) => [...prev, { ...tpl, pubkey, created_at: at, id: optId, sig: "" } as unknown as NostrEvent]);
    }
    markIssueRead(issue.event.id, at);
    const word = isCrashIssue(issue) ? ERROR_WORD[status] : statusLabel(status);
    toast({ title: `Marked ${word}`, description: isCrashIssue(issue) ? undefined : "They'll see it in Your tickets." });
    try {
      if (issue.private) {
        const res = await sendPrivateReply({ signer, myPubkey: pubkey, recipientPubkey: issue.reporter, issueRumorId: issue.event.id, body: "", statusTag: status });
        if (!res.success) throw new Error(res.error || "Send failed");
      } else {
        const signed = await signWithTimeout(signer, buildStatusTemplate({ issue: issue.event, status, recipient: effectiveRecipient }));
        await publishEvent(signed, [relayUrl], issue.reporter, false);
      }
    } catch (err) {
      if (issue.private) setOptimisticRumors((prev) => prev.filter((r) => r.id !== optId));
      else setOptimisticEvents((prev) => prev.filter((e) => e.id !== optId));
      toast({ title: "Couldn't change the status", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    }
  };

  if (discovering) {
    return <p className="py-10 text-center text-sm text-muted-foreground" role="status">Loading the inbox…</p>;
  }
  if (!operatorPubkey) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground" data-testid="feedback-no-operator">
        {signer ? `${relayName} doesn't say who runs it, so feedback has nowhere to go.` : "Sign in as this community's owner to see what members send."}
      </p>
    );
  }

  if (selected) {
    return mode === "errors" || isCrashIssue(selected)
      ? <ErrorDetail issue={selected} group={crashGroups.find((g) => g.latest.event.id === selected.event.id || g.sig === (selected.event.tags.find((x) => x[0] === CRASH_SIG_TAG)?.[1]))} onBack={() => setSelectedId(null)} onStatus={(s) => void changeStatus(selected, s)} />
      : <TicketDetail issue={selected} me={pubkey ?? null} relayName={relayName} untied={untiedIds.has(selected.event.id)} trust={wotEnabled ? getTrustPhrase(isAuthorFlagged(selected.reporter) ? "flagged" : getAuthorTier(selected.reporter)) : ""}
          reply={reply} setReply={setReply} posting={posting} onSend={postReply} onBack={() => setSelectedId(null)} onStatus={(s) => void changeStatus(selected, s)} canWrite={!!signer} />;
  }

  if (mode === "errors") {
    const statuses = deriveCrashStatuses(crashGroups);
    const isDone = (g: CrashGroup) => ["fixed", "ignored"].includes(statuses[g.sig]);
    const errCounts = { needs: crashGroups.filter((g) => !isDone(g)).length, all: crashGroups.length, done: crashGroups.filter(isDone).length };
    const shown = crashGroups.filter((g) => view === "all" || (view === "done" ? isDone(g) : !isDone(g)));
    return (
      <div className="space-y-3" data-testid="feedback-errors">
        <ViewTabs view={view} setView={setView} counts={errCounts} />
        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{view === "needs" ? "No app errors waiting." : "Nothing here."}</p>
        ) : (
          <ul className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {shown.map((g) => {
              const members = crashIssues.filter((i) => (i.event.tags.find((x) => x[0] === CRASH_SIG_TAG)?.[1] || i.event.id) === g.sig);
              const st = issueStatusForCrashStatus(statuses[g.sig]);
              // A never-opened error already reads "New"; once seen, an unseen occurrence means it came back.
              const seenBefore = members.some((i) => getIssueLastRead(i.event.id) > 0);
              const fresh = seenBefore && members.some((i) => hasNewFromOthers(i, pubkey ?? null));
              return (
                <li key={g.sig}>
                  <button type="button" onClick={() => open(g.latest)} className="w-full text-left px-3.5 py-3 min-h-[56px] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]" data-testid={`card-crash-group-${g.sig}`}>
                    <p className="text-[13px]">
                      <span className={STATUS_TONE[st]}>{ERROR_WORD[st]}</span>
                      {fresh && <span className="ml-2 font-medium text-brand" data-testid={`new-crash-${g.sig}`}>Happened again</span>}
                    </p>
                    <p className="mt-0.5 text-[15px] font-medium leading-snug truncate">{g.latest.title}</p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      Happened {g.count} {g.count === 1 ? "time" : "times"}{g.route ? ` · last on ${g.route}` : ""} · {ago(g.latest.latestActivityAt)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  const newHere = items.filter((t) => hasNewFromOthers(t, pubkey ?? null));
  return (
    <div className="space-y-3" data-testid="feedback-inbox">
      {recipient && !recipient.hasInbox && onOpenMemberInbox && (
        <p className="text-[13px] text-muted-foreground" data-testid="feedback-enable-line">
          Members have no way to contact you from {relayName}'s page yet.{" "}
          <button type="button" onClick={onOpenMemberInbox} className="min-h-[44px] font-medium text-brand underline-offset-4 hover:underline" data-testid="button-open-member-inbox">
            Turn on Contact the team
          </button>
        </p>
      )}
      {nip44Missing && (
        <p className="text-[13px] text-amber-700 dark:text-amber-400" data-testid="notice-feedback-nip44">
          Your sign-in can't open private messages, so private tickets won't show here. A browser extension like Alby or nos2x can.
        </p>
      )}
      {/* Phones: the views get the whole row; the actions sit under them. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="w-full sm:w-auto"><ViewTabs view={view} setView={setView} counts={counts} /></div>
        <div className="ml-auto flex items-center gap-1">
          {newHere.length > 0 && (
            <button type="button" onClick={() => markIssuesRead(newHere)} className="min-h-[44px] px-2 text-[13px] whitespace-nowrap text-muted-foreground hover:text-foreground" data-testid="button-feedback-mark-all-read">Mark all read</button>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" className={`h-11 rounded-full px-3 text-[13px] ${filterOn ? "text-brand" : ""}`} data-testid="feedback-filter">
                <SlidersHorizontal className="w-4 h-4 mr-1.5" />Filter{filterOn ? " · on" : ""}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-4" data-testid="feedback-filter-panel">
              <div>
                <p className="text-[12px] font-medium text-muted-foreground mb-1.5">Kind of message</p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(KIND_WORD) as FeedbackType[]).map((k) => {
                    const on = filter.types.includes(k);
                    return (
                      <button key={k} type="button" aria-pressed={on} onClick={() => setFilter((f) => ({ ...f, types: on ? f.types.filter((x) => x !== k) : [...f.types, k] }))}
                        className={`min-h-[44px] px-3 rounded-full border text-[13px] ${on ? "border-brand text-brand bg-brand/[0.06]" : "border-black/[0.1] dark:border-white/[0.12]"}`}
                        data-testid={`feedback-filter-type-${k}`}>{KIND_WORD[k]}</button>
                    );
                  })}
                </div>
              </div>
              {wotEnabled && (
                <label className="flex items-center justify-between gap-3 text-[14px]">
                  Only people you trust
                  <Switch checked={filter.trustedOnly} onCheckedChange={(v) => setFilter((f) => ({ ...f, trustedOnly: v }))} data-testid="feedback-filter-trusted" />
                </label>
              )}
              <div>
                <p className="text-[12px] font-medium text-muted-foreground mb-1.5">When</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {WHEN.map((w) => (
                    <button key={w.id} type="button" aria-pressed={filter.when === w.id} onClick={() => setFilter((f) => ({ ...f, when: w.id }))}
                      className={`min-h-[44px] px-2 rounded-lg text-[13px] text-left ${filter.when === w.id ? "text-brand font-medium" : "text-foreground/80 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"}`}
                      data-testid={`feedback-filter-when-${w.id}`}>{w.label}</button>
                  ))}
                </div>
              </div>
              {filterOn && <button type="button" onClick={() => setFilter({ types: [], trustedOnly: false, when: "all" })} className="min-h-[36px] text-[13px] text-muted-foreground hover:text-foreground">Clear filter</button>}
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full" onClick={reload} aria-label="Check for new feedback" data-testid="button-feedback-refresh">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground" data-testid="feedback-empty">
          {filterOn ? "Nothing matches this filter." : view === "needs" ? "Nothing waiting on you." : view === "done" ? "Nothing resolved or closed yet." : `No feedback yet. When members write to ${relayName}, it lands here.`}
        </p>
      ) : (
        <ul className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06]">
          {items.map((t) => {
            const fresh = hasNewFromOthers(t, pubkey ?? null);
            const replies = t.comments.filter((c) => c.content.trim()).length;
            return (
              <li key={t.event.id}>
                <button type="button" onClick={() => open(t)} className="w-full text-left flex items-start gap-3 px-3.5 py-3 min-h-[64px] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]" data-testid={`card-feedback-issue-${t.event.id.slice(0, 8)}`}>
                  <PersonFace pubkey={t.reporter} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-x-2 flex-wrap text-[13px]">
                      <span className="font-medium text-foreground truncate max-w-[12rem]"><PersonName pubkey={t.reporter} /></span>
                      <span className={STATUS_TONE[t.status]}>{statusLabel(t.status)}</span>
                      {(templateLabelFor(t.event, recipient?.templates) || t.type[0]) && <span className="text-muted-foreground">{templateLabelFor(t.event, recipient?.templates) ?? KIND_WORD[t.type[0]] ?? ""}</span>}
                      {t.private && <span className="inline-flex items-center gap-1 text-muted-foreground"><Lock className="w-3 h-3" aria-hidden="true" />Private</span>}
                      {fresh && <span className="font-medium text-brand" data-testid={`dot-feedback-unread-${t.event.id.slice(0, 8)}`}>New</span>}
                    </span>
                    <span className="mt-0.5 block text-[15px] font-medium leading-snug truncate">{t.title}</span>
                    {stripContextBlock(t.event.content).trim() && <span className="mt-0.5 block text-[13px] text-muted-foreground truncate">{stripContextBlock(t.event.content).trim()}</span>}
                    <span className="mt-1 block text-[12px] text-muted-foreground">
                      {ago(t.latestActivityAt)}{replies ? ` · ${replies} ${replies === 1 ? "reply" : "replies"}` : ""}{untiedIds.has(t.event.id) ? " · not tied to a community" : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ViewTabs({ view, setView, counts }: { view: FeedbackViewId; setView: (v: FeedbackViewId) => void; counts: Record<FeedbackViewId, number> }) {
  const tabs: { id: FeedbackViewId; label: string }[] = [{ id: "needs", label: "Needs you" }, { id: "all", label: "All" }, { id: "done", label: "Done" }];
  return (
    <div role="tablist" aria-label="Show" className="flex gap-1 border-b border-black/[0.06] dark:border-white/[0.08]">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={view === t.id} onClick={() => setView(t.id)}
          className={`min-h-[44px] px-3 text-[14px] whitespace-nowrap border-b-2 -mb-px ${view === t.id ? "border-brand text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          data-testid={`feedback-view-${t.id}`}>
          {t.label} <span className="tabular-nums text-muted-foreground">{counts[t.id]}</span>
        </button>
      ))}
    </div>
  );
}

function StatusControl({ value, words, onChange }: { value: FeedbackStatus; words: Record<FeedbackStatus, string>; onChange: (s: FeedbackStatus) => void }) {
  return (
    <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-1.5" data-testid="feedback-status-control">
      {STATUSES.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} onClick={() => onChange(s)}
          className={`min-h-[44px] px-3.5 rounded-full border text-[13px] ${value === s ? "border-brand bg-brand/[0.08] text-brand font-medium" : "border-black/[0.1] dark:border-white/[0.12] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"}`}
          data-testid={`button-feedback-status-${s}`}>{words[s]}</button>
      ))}
    </div>
  );
}

function DeviceDetails({ issue }: { issue: FeedbackIssue }) {
  const c = issue.contextBlock;
  if (!c) return null;
  return (
    <details className="text-[13px]" data-testid="feedback-device">
      <summary className="cursor-pointer min-h-[40px] flex items-center text-muted-foreground hover:text-foreground">Device details</summary>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-muted-foreground">
        <dt>Page</dt><dd className="font-mono text-[12px] text-foreground/80">{c.route}</dd>
        <dt>Screen</dt><dd className="text-foreground/80">{c.viewport}</dd>
        <dt>Signed in with</dt><dd className="text-foreground/80">{c.signerType}</dd>
        <dt>App version</dt><dd className="text-foreground/80">{c.appVersion}</dd>
      </dl>
    </details>
  );
}

function TicketDetail({ issue, me, relayName, untied, trust, reply, setReply, posting, onSend, onBack, onStatus, canWrite }: {
  issue: FeedbackIssue; me: string | null; relayName: string; untied: boolean; trust: string;
  reply: string; setReply: (s: string) => void; posting: boolean; onSend: (text?: string) => void;
  onBack: () => void; onStatus: (s: FeedbackStatus) => void; canWrite: boolean;
}) {
  const saved = useSavedReplies();
  const [editing, setEditing] = useState(false);
  const body = stripContextBlock(issue.event.content).trim();
  return (
    <div className="space-y-5" data-testid="feedback-detail">
      <button type="button" onClick={onBack} className="-ml-2 inline-flex items-center gap-0.5 min-h-[44px] pl-1.5 pr-2.5 rounded-full text-sm text-brand hover:bg-brand/[0.06]" data-testid="button-feedback-back">
        <ChevronLeft className="w-5 h-5" aria-hidden="true" />Inbox
      </button>
      <header className="flex items-start gap-3">
        <PersonFace pubkey={issue.reporter} size="w-11 h-11" />
        <div className="min-w-0">
          <h3 className="text-[18px] font-semibold tracking-tight leading-snug">{issue.title}</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <span className="text-foreground/90"><PersonName pubkey={issue.reporter} /></span>{trust ? ` · ${trust}` : ""} · {issue.type[0] ? `${KIND_WORD[issue.type[0]]} · ` : ""}{issue.private ? "Private" : "Public"} · {ago(issue.createdAt)}
            {untied ? " · not tied to a community" : ""}
          </p>
        </div>
      </header>
      <section aria-label="Status">
        <p className="text-[12px] font-medium text-muted-foreground mb-1.5">Status — {issue.private ? "they'll see it" : "anyone following it sees it"}</p>
        <StatusControl value={issue.status} words={{ open: statusLabel("open"), draft: statusLabel("draft"), resolved: statusLabel("resolved"), closed: statusLabel("closed") }} onChange={onStatus} />
      </section>
      <p className="text-[15px] leading-relaxed whitespace-pre-wrap" data-testid="feedback-body">{body || <span className="text-muted-foreground">No details.</span>}</p>
      <DeviceDetails issue={issue} />

      <section aria-label="Conversation" className="space-y-2" data-testid="feedback-thread">
        {threadItems(issue).map((item) => {
          if (item.kind === "status") {
            return (
              <p key={`s-${item.at}-${item.status}`} className="text-center text-[12px] text-muted-foreground py-1" data-testid="feedback-status-line">
                {item.by === me ? "You" : <PersonName pubkey={item.by} />} marked this <span className="font-medium text-foreground/80">{statusLabel(item.status)}</span> · {ago(item.at)}
              </p>
            );
          }
          const mine = item.event.pubkey === me;
          return (
            <div key={item.event.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 ${mine ? "bg-brand/[0.12] rounded-br-sm" : "bg-black/[0.04] dark:bg-white/[0.06] rounded-bl-sm"}`}>
                {!mine && <p className="text-[12px] font-medium mb-0.5"><PersonName pubkey={item.event.pubkey} /></p>}
                <p className="text-[14px] whitespace-pre-wrap">{item.event.content}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 text-right">{ago(item.at)}</p>
              </div>
            </div>
          );
        })}
      </section>

      <section aria-label="Reply" className="space-y-2">
        <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder={issue.private ? "Reply privately…" : "Reply — anyone following this can read it"} rows={3} className="text-[15px]" data-testid="textarea-feedback-reply" />
        <div className="flex items-center gap-2">
          {/* Not modal: "Edit saved replies…" opens a dialog from this menu, and a
              modal menu leaves the page unclickable after that dialog closes. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-11 rounded-full px-3 text-[13px]" data-testid="feedback-saved-replies"><MessageSquareText className="w-4 h-4 mr-1.5" />Saved replies</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]" data-testid="feedback-saved-replies-menu">
              {saved.replies.length === 0 && <p className="px-2 py-2 text-[13px] text-muted-foreground">No saved replies yet.</p>}
              {saved.replies.map((r) => (
                <DropdownMenuItem key={r.id} onSelect={() => setReply(reply.trim() ? `${reply.trim()}\n\n${r.text}` : r.text)} className="min-h-[44px] text-[14px] whitespace-normal" data-testid="feedback-saved-reply">{r.text}</DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setEditing(true)} className="min-h-[44px] text-[13px] text-muted-foreground" data-testid="feedback-saved-replies-edit">Edit saved replies…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => onSend()} disabled={posting || !reply.trim() || !canWrite} className="ml-auto h-11 rounded-full px-5" data-testid="button-feedback-post-reply">
            <Send className="w-4 h-4 mr-1.5" />{posting ? "Sending…" : "Send"}
          </Button>
        </div>
      </section>
      <SavedRepliesEditor open={editing} onClose={() => setEditing(false)} saved={saved} />
    </div>
  );
}

function SavedRepliesEditor({ open, onClose, saved }: { open: boolean; onClose: () => void; saved: ReturnType<typeof useSavedReplies> }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<SavedReply[]>(saved.replies);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setDraft(saved.replies); }, [open, saved.replies]);
  const save = async () => {
    setBusy(true);
    try { await saved.save(draft); toast({ title: "Saved replies updated", description: "Encrypted to you, on every device you sign in on." }); onClose(); }
    catch (err) { toast({ title: "Couldn't save", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="feedback-saved-replies-editor">
        <DialogHeader><DialogTitle>Saved replies</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-[55vh] overflow-y-auto">
          {draft.map((r, i) => (
            <div key={r.id} className="flex items-start gap-2">
              <Textarea value={r.text} rows={2} className="text-[14px]" onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} data-testid="feedback-saved-reply-text" />
              <button type="button" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} className="min-h-[44px] px-2 text-[13px] text-muted-foreground hover:text-red-600" aria-label="Remove this reply">Remove</button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="h-11 rounded-full px-3 text-[13px]" onClick={() => setDraft((d) => [...d, { id: Math.random().toString(36).slice(2, 10), text: "" }])} data-testid="feedback-saved-reply-add">Add a reply</Button>
          <Button className="ml-auto h-11 rounded-full px-5" onClick={save} disabled={busy || !saved.loaded} data-testid="feedback-saved-replies-save">{busy ? "Saving…" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ErrorDetail({ issue, group, onBack, onStatus }: { issue: FeedbackIssue; group?: CrashGroup; onBack: () => void; onStatus: (s: FeedbackStatus) => void }) {
  return (
    <div className="space-y-5" data-testid="feedback-error-detail">
      <button type="button" onClick={onBack} className="-ml-2 inline-flex items-center gap-0.5 min-h-[44px] pl-1.5 pr-2.5 rounded-full text-sm text-brand hover:bg-brand/[0.06]" data-testid="button-feedback-back">
        <ChevronLeft className="w-5 h-5" aria-hidden="true" />App errors
      </button>
      <header>
        <h3 className="text-[18px] font-semibold tracking-tight leading-snug break-words">{issue.title}</h3>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Happened {group?.count ?? 1} {(group?.count ?? 1) === 1 ? "time" : "times"}{group?.route ? ` · last on ${group.route}` : ""} · {ago(issue.latestActivityAt)} · sent anonymously by the app
        </p>
      </header>
      <section aria-label="Status">
        <p className="text-[12px] font-medium text-muted-foreground mb-1.5">Status</p>
        <StatusControl value={issue.status} words={ERROR_WORD} onChange={onStatus} />
      </section>
      <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-muted p-3 text-[12px] leading-relaxed font-mono whitespace-pre-wrap break-all" data-testid="feedback-error-stack">{stripContextBlock(issue.event.content)}</pre>
      <DeviceDetails issue={issue} />
    </div>
  );
}
