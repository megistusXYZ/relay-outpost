/**
 * Community › Ideas — members' public suggestions, voted up (owner,
 * 2026-10-03: "a suggestions board"). Like a Discord forum channel or a
 * feature-request board: the most-wanted first, the team's status beside
 * each, done ones apart. A vote is a "+" reaction; taking it back deletes it
 * (lib/suggestions.ts). Ideas come in through Contact the team.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Event as NostrEvent, Filter } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import { formatDistanceToNow } from "date-fns";
import { ChevronUp, ChevronDown } from "lucide-react";
import { pool, publishEvent, eventStore, fetchProfilesCached } from "@/lib/nostr";
import { KIND_METADATA, getDisplayName, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { signWithTimeout } from "@/lib/signer-timeout";
import { hydrateIssues, openFeedbackDrawer, statusLabel, stripContextBlock, type FeedbackRecipient } from "@/lib/nip34-feedback";
import { threadItems, ticketsForRelay } from "@/lib/feedback-needs";
import { isSuggestion, rankSuggestions, unvoteTemplate, voteTemplate, type RankedSuggestion } from "@/lib/suggestions";
import { Button } from "@/components/ui/button";

const STATUS_KINDS = [1630, 1631, 1632, 1633];

function Name({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  useEffect(() => { fetchProfilesCached([pubkey]); }, [pubkey]);
  return <>{profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey))}</>;
}

/** Collect everything a live subscription sends, deduped by id. */
function useLive(relay: string, filter: Filter | null, key: string): NostrEvent[] {
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const seen = useRef(new Map<string, NostrEvent>());
  useEffect(() => {
    seen.current = new Map();
    setEvents([]);
    if (!filter) return;
    let flush: number | null = null;
    const sub = pool.subscribeMany([relay], filter, {
      onevent(e: NostrEvent) {
        if (seen.current.has(e.id)) return;
        seen.current.set(e.id, e);
        if (flush === null) flush = window.setTimeout(() => { flush = null; setEvents([...seen.current.values()]); }, 80);
      },
    });
    return () => { sub.close(); if (flush !== null) clearTimeout(flush); };
    // `key` stands for the filter's contents.
  }, [relay, key]);
  return events;
}

export function SuggestionsBoard({ relayUrl, recipient }: { relayUrl: string; recipient: FeedbackRecipient }) {
  const { signer, pubkey } = useNostrAuth();
  const { toast } = useToast();
  const op = recipient.operatorPubkey!;
  const tickets = useLive(relayUrl, { kinds: [1621], "#p": [op], limit: 500 } as Filter, `t:${op}`);
  const ids = useMemo(() => tickets.map((t) => t.id).sort(), [tickets]);
  const around = useLive(relayUrl, ids.length ? ({ kinds: [7, 1111, 1622, ...STATUS_KINDS], "#e": ids } as Filter) : null, `a:${ids.join()}`);
  const [mine, setMine] = useState<NostrEvent[]>([]); // this device's votes and take-backs, shown at once
  const reactionIds = useMemo(() => [...around, ...mine].filter((e) => e.kind === 7).map((e) => e.id).sort(), [around, mine]);
  const deletions = useLive(relayUrl, reactionIds.length ? ({ kinds: [5], "#e": reactionIds } as Filter) : null, `d:${reactionIds.join()}`);

  const board = useMemo(() => {
    const issues = hydrateIssues([...tickets, ...around.filter((e) => e.kind !== 7)]);
    const here = ticketsForRelay(issues, relayUrl);
    const suggestions = [...here.here, ...here.untied].filter((t) => isSuggestion(t, recipient.templates));
    return rankSuggestions(suggestions, [...around, ...mine].filter((e) => e.kind === 7), [...deletions, ...mine.filter((e) => e.kind === 5)], pubkey ?? null);
  }, [tickets, around, mine, deletions, relayUrl, recipient.templates, pubkey]);

  const [busy, setBusy] = useState<string | null>(null);
  const toggleVote = async (s: RankedSuggestion) => {
    if (!signer || !pubkey) { toast({ title: "Sign in to vote", description: "Votes are signed with your key." }); return; }
    setBusy(s.issue.event.id);
    try {
      const signed = await signWithTimeout(signer, s.myVote ? unvoteTemplate(s.myVote) : voteTemplate(s.issue.event)) as unknown as NostrEvent;
      setMine((m) => [...m, signed]);
      await publishEvent(signed, [relayUrl], undefined, true);
    } catch (err) {
      toast({ title: s.myVote ? "Couldn't take your vote back" : "Couldn't vote", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const suggestTemplate = recipient.templates?.find((t) => t.enabled && t.visibility === "public");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const row = (s: RankedSuggestion) => {
    const t = s.issue;
    const body = stripContextBlock(t.event.content).trim();
    const replies = t.comments.filter((c) => c.content.trim()).length;
    const expanded = openId === t.event.id;
    return (
      <li key={t.event.id} className="flex items-start gap-3 py-3" data-testid="suggestion" data-id={t.event.id} data-votes={s.votes}>
        <button type="button" onClick={() => void toggleVote(s)} disabled={busy === t.event.id} aria-pressed={!!s.myVote}
          aria-label={s.myVote ? `Take back your vote (${s.votes})` : `Vote for this (${s.votes})`}
          className={`shrink-0 flex flex-col items-center justify-center w-12 min-h-[52px] rounded-xl border text-[14px] font-semibold tabular-nums transition-colors ${s.myVote ? "border-brand bg-brand/[0.1] text-brand" : "border-black/[0.1] dark:border-white/[0.12] hover:border-brand/40"}`}
          data-testid="suggestion-vote">
          <ChevronUp className="w-4 h-4" aria-hidden="true" />{s.votes}
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => setOpenId(expanded ? null : t.event.id)} className="text-left w-full min-h-[44px]" aria-expanded={expanded} data-testid="suggestion-open">
            <span className="block text-[15px] font-medium leading-snug">{t.title}</span>
            {body && !expanded && <span className="block text-[13px] text-muted-foreground truncate">{body}</span>}
          </button>
          <p className="text-[12px] text-muted-foreground">
            <Name pubkey={t.reporter} />
            {t.status !== "open" && <> · <span className={t.status === "draft" ? "text-amber-700 dark:text-amber-400" : t.status === "resolved" ? "text-success dark:text-emerald-400" : ""} data-testid="suggestion-status">{t.status === "resolved" ? "Done" : statusLabel(t.status)}</span></>}
            {replies ? ` · ${replies} ${replies === 1 ? "reply" : "replies"}` : ""} · {formatDistanceToNow(t.createdAt * 1000, { addSuffix: true })}
          </p>
          {expanded && (
            <div className="mt-2 space-y-2" data-testid="suggestion-detail">
              {body && <p className="text-[14px] whitespace-pre-wrap">{body}</p>}
              {threadItems(t).map((item) => item.kind === "status"
                ? <p key={`s${item.at}`} className="text-[12px] text-muted-foreground"><Name pubkey={item.by} /> marked this {item.status === "resolved" ? "Done" : statusLabel(item.status)}</p>
                : <p key={item.event.id} className="text-[14px] rounded-xl bg-black/[0.04] dark:bg-white/[0.06] px-3 py-2"><span className="block text-[12px] font-medium"><Name pubkey={item.event.pubkey} /></span>{item.event.content}</p>)}
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-3" data-testid="suggestions-board">
      <div className="flex items-center gap-3">
        <p className="text-[14px] text-muted-foreground flex-1">Ideas from members. Vote for the ones you want — the team sees what's wanted most.</p>
        {suggestTemplate && (
          <Button className="h-11 rounded-full px-4 shrink-0" onClick={() => openFeedbackDrawer({ initialRecipient: recipient, initialTemplate: suggestTemplate.id })} data-testid="suggestion-new">
            Suggest an idea
          </Button>
        )}
      </div>
      {board.open.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground" data-testid="suggestions-empty">No ideas yet. Be the first to suggest one.</p>
      ) : (
        <ul className="divide-y divide-black/[0.06] dark:divide-white/[0.08] border-y border-black/[0.06] dark:border-white/[0.08]" data-testid="suggestions-open">{board.open.map(row)}</ul>
      )}
      {board.done.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowDone((v) => !v)} className="min-h-[44px] inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground" aria-expanded={showDone} data-testid="suggestions-done-toggle">
            Done and closed · {board.done.length}<ChevronDown className={`w-4 h-4 transition-transform ${showDone ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {showDone && <ul className="divide-y divide-black/[0.06] dark:divide-white/[0.08]" data-testid="suggestions-done">{board.done.map(row)}</ul>}
        </div>
      )}
    </div>
  );
}
