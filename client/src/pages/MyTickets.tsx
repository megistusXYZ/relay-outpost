import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { hasNewFromOthers, threadItems } from "@/lib/feedback-needs";
import { useSearch, useLocation } from "wouter";
import { PageToolbar } from "@/components/PageToolbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { signWithTimeout } from "@/lib/signer-timeout";
import { publishEvent, fetchProfilesCached, eventStore } from "@/lib/nostr";
import { use$ } from "applesauce-react/hooks";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  KIND_METADATA, getAvatarUrl, getDisplayName, formatNpub, shortenNpub,
} from "@/lib/nostr-helpers";
import { formatDistanceToNow } from "date-fns";
import { ChevronLeft, Send, Inbox, RefreshCw, MessageSquare, Lock, Globe } from "lucide-react";
import {
  type FeedbackType,
  type FeedbackStatus,
  statusLabel,
  type FeedbackIssue,
  subscribeMyTickets,
  subscribePrivateFeedback,
  hydratePrivateTickets,
  hydrateIssues,
  recipientFromIssue,
  buildCommentTemplate,
  sendPrivateReply,
  stripContextBlock,
  markIssueRead,
  renderableComments,
} from "@/lib/nip34-feedback";
import type { UnwrappedRumor } from "@/lib/dm";
import type { Event as NostrEvent } from "nostr-tools";

// The words come from the shared statusLabel() — the operator's screen uses the
// same ones, so the person who reported something sees what the operator set.
const STATUS_COLOR: Record<FeedbackStatus, string> = {
  open: "border-emerald-400/40 text-emerald-700 dark:text-emerald-300/80 bg-emerald-500/10",
  draft: "border-amber-400/40 text-amber-700 dark:text-amber-300/80 bg-amber-500/10",
  resolved: "border-blue-400/40 text-blue-700 dark:text-blue-300/80 bg-blue-500/10",
  closed: "border-muted-foreground/30 text-muted-foreground/60 bg-muted/20",
};
const TYPE_LABEL: Record<FeedbackType, string> = { bug: "Bug", idea: "Idea", ux: "UX", question: "Question" };

function PersonChip({ pubkey, fallbackLabel }: { pubkey: string; fallbackLabel?: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  useEffect(() => { if (pubkey) fetchProfilesCached([pubkey]); }, [pubkey]);
  const name = profile ? getDisplayName(profile) : (fallbackLabel || shortenNpub(formatNpub(pubkey)));
  const avatar = profile ? getAvatarUrl(profile) : null;
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Avatar className="w-5 h-5 border border-border/40">
        {avatar && <AvatarImage src={avatar} alt={name || ""} />}
        <AvatarFallback className="text-[8px] bg-brand/10 text-brand">
          {(name || "?").slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-[11px] truncate max-w-[140px]">{name}</span>
    </div>
  );
}

export default function MyTickets() {
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  useDocumentTitle("Tickets & Feedback");

  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [privateRumors, setPrivateRumors] = useState<UnwrappedRumor[]>([]);
  // Optimistic replies — shown instantly, deduped once the real event echoes back.
  const [optimisticEvents, setOptimisticEvents] = useState<NostrEvent[]>([]);
  const [optimisticRumors, setOptimisticRumors] = useState<UnwrappedRumor[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!pubkey) return;
    const sub = subscribeMyTickets(pubkey, setEvents);
    return () => sub.close();
  }, [pubkey]);

  useEffect(() => {
    if (!signer || !pubkey) return;
    const sub = subscribePrivateFeedback(signer, pubkey, setPrivateRumors);
    return () => sub.close();
  }, [signer, pubkey]);

  const tickets = useMemo(() => {
    const byId = new Map<string, NostrEvent>();
    for (const e of [...events, ...optimisticEvents]) byId.set(e.id, e);
    const pub = hydrateIssues(Array.from(byId.values()));
    // Dedup private rumors by author+kind+content so an optimistic reply collapses
    // into the real one once the encrypted self-copy echoes back.
    const seen = new Set<string>();
    const rumors: UnwrappedRumor[] = [];
    for (const r of [...privateRumors, ...optimisticRumors]) {
      // The status is part of the key: two status changes on one ticket are
      // both empty messages, and the second used to collapse into the first.
      const key = `${r.pubkey}|${r.kind}|${r.content}|${r.tags.find((t) => t[0] === "E")?.[1] || ""}|${r.tags.find((t) => t[0] === "status")?.[1] || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rumors.push(r);
    }
    const priv = hydratePrivateTickets(rumors);
    return [...pub, ...priv].sort((a, b) => b.latestActivityAt - a.latestActivityAt);
  }, [events, optimisticEvents, privateRumors, optimisticRumors]);
  const selected = useMemo(() => tickets.find((t) => t.event.id === selectedId) || null, [tickets, selectedId]);

  // Deep-link: /tickets?id=<issueId> (e.g. from a ticket notification) opens that
  // thread once it hydrates, and marks it read. Applied once per id.
  const search = useSearch();
  const [, navigate] = useLocation();
  const deepLinkId = useMemo(() => new URLSearchParams(search).get("id"), [search]);
  const deepLinkAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkId) { deepLinkAppliedRef.current = null; return; }
    if (deepLinkAppliedRef.current === deepLinkId) return;
    if (tickets.some((t) => t.event.id === deepLinkId)) {
      deepLinkAppliedRef.current = deepLinkId;
      setSelectedId(deepLinkId);
      markIssueRead(deepLinkId);
    }
  }, [deepLinkId, tickets]);

  const sendReply = useCallback(async () => {
    if (!signer || !selected || !reply.trim()) return;
    setPosting(true);
    try {
      const recipient = recipientFromIssue(selected.event);
      const now = Math.floor(Date.now() / 1000);
      if (selected.private) {
        if (!pubkey || !recipient.operatorPubkey) throw new Error("Missing operator key");
        const res = await sendPrivateReply({ signer, myPubkey: pubkey, recipientPubkey: recipient.operatorPubkey, issueRumorId: selected.event.id, body: reply.trim() });
        if (!res.success) throw new Error(res.error || "Send failed");
        setOptimisticRumors((prev) => [...prev, { pubkey: pubkey!, kind: 1111, tags: [["E", selected.event.id]], content: reply.trim(), created_at: now, id: `opt-${now}-${Math.random().toString(36).slice(2)}` }]);
      } else {
        const tpl = buildCommentTemplate({ issue: selected.event, body: reply.trim(), recipient });
        const signed = await signWithTimeout(signer, tpl);
        const relays = recipient.relay ? [recipient.relay] : [];
        await publishEvent(signed, relays, recipient.operatorPubkey || undefined, false);
        setOptimisticEvents((prev) => [...prev, signed as unknown as NostrEvent]);
      }
      setReply("");
      toast({ title: "Reply sent" });
    } catch (err) {
      toast({ title: "Could not send reply", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setPosting(false);
    }
  }, [signer, selected, reply, toast, pubkey]);

  if (!pubkey) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <Card className="glass-card p-6 text-center">
          <Inbox className="w-9 h-9 mx-auto text-brand/60 mb-3" />
          <h2 className="text-base font-brand uppercase tracking-widest mb-1">Your tickets</h2>
          <p className="text-sm text-muted-foreground/70">Sign in to see the feedback you've sent and any replies.</p>
        </Card>
      </div>
    );
  }

  // Detail view — chat-style thread.
  if (selected) {
    const recipient = recipientFromIssue(selected.event);
    return (
      <div className="max-w-2xl mx-auto px-3 sm:px-4 pt-4 sm:pt-6 pb-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => { setSelectedId(null); if (deepLinkId) navigate("/tickets"); }} data-testid="button-mytickets-back">
          <ChevronLeft className="w-3.5 h-3.5 mr-1" /> All tickets
        </Button>

        <Card className="glass-card p-4">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge variant="outline" className={`text-[10px] ${STATUS_COLOR[selected.status]}`}>{statusLabel(selected.status)}</Badge>
            {selected.type.map((t) => (
              <Badge key={t} variant="outline" className="text-[10px] border-brand/40 text-brand">{TYPE_LABEL[t]}</Badge>
            ))}
            <span className="text-[10px] text-muted-foreground/50 ml-auto">{formatDistanceToNow(selected.createdAt * 1000, { addSuffix: true })}</span>
          </div>
          <h3 className="text-base font-medium mb-1">{selected.title}</h3>
          <div className="text-[11px] text-muted-foreground/60 mb-2 flex items-center gap-1.5">
            <span>to</span>
            {recipient.operatorPubkey ? <PersonChip pubkey={recipient.operatorPubkey} fallbackLabel={recipient.label} /> : <span>{recipient.label}</span>}
          </div>
          <p className="text-sm whitespace-pre-wrap text-foreground/80">{stripContextBlock(selected.event.content) || <span className="text-muted-foreground/50 italic">No additional details.</span>}</p>
        </Card>

        {/* Chat thread */}
        <div className="space-y-2">
          {threadItems(selected).map((item) => {
            if (item.kind === "status") {
              // A status change is a line in the conversation, not an empty bubble.
              const who = item.by === pubkey ? "You" : null;
              return (
                <p key={`s-${item.at}-${item.status}`} className="text-center text-[12px] text-muted-foreground py-1" data-testid="myticket-status-line">
                  {who ?? <PersonChip pubkey={item.by} fallbackLabel={recipient.label} />} marked this <span className="font-medium text-foreground/80">{statusLabel(item.status)}</span> · {formatDistanceToNow(item.at * 1000, { addSuffix: true })}
                </p>
              );
            }
            const c = item.event;
            const mine = c.pubkey === pubkey;
            return (
              <div key={c.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${mine ? "bg-brand/15 rounded-br-sm" : "bg-muted/40 rounded-bl-sm"}`}>
                  {!mine && <div className="mb-1"><PersonChip pubkey={c.pubkey} fallbackLabel={recipient.label} /></div>}
                  <p className="text-sm whitespace-pre-wrap text-foreground/85">{c.content}</p>
                  <p className="text-[9px] text-muted-foreground/45 mt-0.5 text-right">{formatDistanceToNow(c.created_at * 1000, { addSuffix: true })}</p>
                </div>
              </div>
            );
          })}
          {threadItems(selected).length === 0 && (
            <p className="text-center text-xs text-muted-foreground/50 py-4">No replies yet. You'll be notified when the operator responds.</p>
          )}
        </div>

        <div className="space-y-2">
          <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" rows={3} className="text-sm" data-testid="textarea-mytickets-reply" />
          <div className="flex justify-end">
            <Button onClick={sendReply} disabled={posting || !reply.trim() || !signer} data-testid="button-mytickets-send-reply">
              {posting ? <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-2" />}
              Reply
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // List view.
  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-4 pt-4 sm:pt-6 pb-6 space-y-4">
      <PageToolbar
        inStack
        status={<span>{tickets.length} {tickets.length === 1 ? "ticket" : "tickets"}</span>}
      >
        {/* Creating belongs where reading happens: summon the same global
            feedback composer the What's New footer uses. */}
        <Button
          size="sm"
          className="h-8 gap-1.5 rounded-full"
          onClick={() => window.dispatchEvent(new CustomEvent("relay-outpost:open-feedback", { detail: { initialType: "question" } }))}
          data-testid="button-mytickets-new"
        >
          <Send className="w-3.5 h-3.5" />
          New ticket
        </Button>
      </PageToolbar>

      {tickets.length === 0 ? (
        <Card className="glass-card p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground/60">You haven't sent any feedback yet.</p>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => window.dispatchEvent(new CustomEvent("relay-outpost:open-feedback", { detail: { initialType: "question" } }))}
            data-testid="button-mytickets-new-empty"
          >
            Send your first ticket
          </Button>
        </Card>
      ) : (
        <div className="space-y-2">
          {tickets.map((t: FeedbackIssue) => {
            const unread = hasNewFromOthers(t, pubkey ?? null);
            const recipient = recipientFromIssue(t.event);
            return (
              <Card
                key={t.event.id}
                className={`glass-card p-3 cursor-pointer hover:border-brand/40 transition-colors ${unread ? "border-brand/30" : ""}`}
                onClick={() => { markIssueRead(t.event.id, t.latestActivityAt); setSelectedId(t.event.id); }}
                data-testid={`card-myticket-${t.event.id.slice(0, 8)}`}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  {t.private
                    ? <Lock className="w-3 h-3 text-brand/70" aria-label="Private" />
                    : <Globe className="w-3 h-3 text-muted-foreground/50" aria-label="Public" />}
                  <Badge variant="outline" className={`text-[9px] ${STATUS_COLOR[t.status]}`}>{statusLabel(t.status)}</Badge>
                  {t.type.map((ty) => (
                    <Badge key={ty} variant="outline" className="text-[9px] border-brand/40 text-brand">{TYPE_LABEL[ty]}</Badge>
                  ))}
                  {unread && <span className="w-1.5 h-1.5 rounded-full bg-brand" data-testid={`dot-myticket-unread-${t.event.id.slice(0, 8)}`} />}
                </div>
                <h4 className="text-sm font-medium mt-1 truncate">{t.title}</h4>
                <div className="flex items-center gap-3 mt-1.5">
                  {recipient.operatorPubkey
                    ? <PersonChip pubkey={recipient.operatorPubkey} fallbackLabel={recipient.label} />
                    : <span className="text-[11px] text-muted-foreground/60">{recipient.label}</span>}
                  <span className="text-[10px] text-muted-foreground/50">{formatDistanceToNow(t.latestActivityAt * 1000, { addSuffix: true })}</span>
                  {renderableComments(t.comments).length > 0 && (
                    <span className="text-[10px] text-muted-foreground/50 inline-flex items-center gap-1">
                      <MessageSquare className="w-2.5 h-2.5" />{renderableComments(t.comments).length}
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
