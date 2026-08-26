/**
 * The "end of thread" engagement block — rendered below the last reply on the
 * focused Thread page (and, in guest mode, on the shared-note preview). Fills
 * the dead space at the bottom of a conversation with three modules:
 *   1. People in this thread — participants (root author + ancestors + reply
 *      authors), unfollowed-first, one-tap follow. Grows the social graph from
 *      the exact people you just read.
 *   2. More from <author> — a few of the root author's other posts (keep-reading).
 *   3. Share this conversation — copy/native-share the thread link (adoption).
 *
 * Guest mode (logged-out shared-note preview): the same block renders, but every
 * action becomes a "Sign in to join the conversation" CTA — the adoption funnel.
 *
 * WoT is intentionally NOT required here: the block stands entirely on universal
 * data (who spoke, who they are), so it works for every user regardless of trust
 * settings.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { nip19, type Event } from "nostr-tools";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { eventStore, fetchProfilesCached, getEventRelays } from "@/lib/nostr";
import { noteShareId } from "@/lib/share-links";
import { getDisplayName, getAvatarUrl, shortenNpub, formatNpub, KIND_METADATA } from "@/lib/nostr-helpers";
import { fetchUserNotesPaginated } from "@/lib/primal-cache";
import { useFollowAction } from "@/hooks/use-follow-action";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { useToast } from "@/hooks/use-toast";
import { Users, Check, Plus, Share2, MessageSquarePlus } from "lucide-react";

const PEOPLE_CAP = 6;
// Only suggest people worth connecting with: someone you already follow, or an
// account with real standing in YOUR web of trust. Keeps bots / bad actors out
// of the "People in this thread" row without a heavy UI. Tunable.
const MIN_SUGGEST_SCORE = 0.05;

function relTime(ts: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function noteHref(id: string): string {
  try { return `/thread/${nip19.noteEncode(id)}`; } catch { return `/thread/${id}`; }
}

/** One follow-able person row. */
function PersonChip({ pubkey, guest, onSignIn }: { pubkey: string; guest: boolean; onSignIn: () => void }) {
  const [, navigate] = useLocation();
  const [profile, setProfile] = useState<Event | null>(null);
  const { follow, pending, isFollowing } = useFollowAction();
  useEffect(() => {
    fetchProfilesCached([pubkey]);
    const tick = () => {
      const ev = (eventStore.getReplaceable?.(KIND_METADATA, pubkey) ?? null) as Event | null;
      if (ev) setProfile(ev);
    };
    tick();
    const i = setInterval(tick, 1500);
    return () => clearInterval(i);
  }, [pubkey]);

  const name = profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey));
  const avatar = profile ? getAvatarUrl(profile) : undefined;
  const followed = !guest && isFollowing(pubkey);
  const busy = pending.has(pubkey);
  const npub = useMemo(() => { try { return nip19.npubEncode(pubkey); } catch { return ""; } }, [pubkey]);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/60 pl-1.5 pr-1 py-1 min-w-0">
      <button
        onClick={() => npub && navigate(`/profile/${npub}`)}
        className="flex items-center gap-1.5 min-w-0"
        aria-label={`View ${name}'s profile`}
      >
        <Avatar className="w-7 h-7 shrink-0">
          {avatar && <AvatarImage src={avatar} alt={name} />}
          <AvatarFallback className="text-[10px] bg-brand/10 text-brand">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="text-xs font-medium truncate max-w-[8rem]">{name}</span>
      </button>
      <Button
        size="sm"
        variant={followed ? "secondary" : "outline"}
        disabled={busy || followed}
        onClick={() => (guest ? onSignIn() : follow(pubkey))}
        className="h-6 px-2 text-[11px] gap-1 shrink-0"
        data-testid={`thread-follow-${pubkey.slice(0, 8)}`}
      >
        {busy ? "…" : followed ? <><Check className="w-3 h-3" />Following</> : <><Plus className="w-3 h-3" />Follow</>}
      </Button>
    </div>
  );
}

interface ThreadEndBlockProps {
  rootEvent: Event;
  /** Ancestor chain (their authors join the participant set). */
  ancestors?: Event[];
  /** Guest mode: swap every action for a sign-in CTA. */
  guest?: boolean;
  /** Explicit participant pubkeys (guest mode passes these in; logged-in derives from the store). */
  participantsOverride?: string[];
  onSignIn?: () => void;
  myPubkey?: string | null;
}

export function ThreadEndBlock({ rootEvent, ancestors, guest = false, participantsOverride, onSignIn, myPubkey }: ThreadEndBlockProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { isFollowing } = useFollowAction();
  const { scores, wotEnabled, isAuthorFlagged } = useGrapeRankScores();
  const [replyPks, setReplyPks] = useState<string[]>([]);
  const [more, setMore] = useState<Event[]>([]);
  const [showAll, setShowAll] = useState(false);

  const rootId = rootEvent.id;
  const signIn = onSignIn ?? (() => navigate("/login"));

  // Derive reply-author pubkeys from the store (ReplyThread populates it). Guest
  // mode passes participants in instead, since it doesn't load the conversation.
  useEffect(() => {
    if (participantsOverride) { setReplyPks(participantsOverride); return; }
    const tick = () => {
      const set = eventStore.getByFilters({ kinds: [1], "#e": [rootId] });
      const pks = set ? [...set].map((e) => e.pubkey) : [];
      setReplyPks((prev) => (prev.length === pks.length && prev.every((p, i) => p === pks[i]) ? prev : pks));
    };
    tick();
    const i = setInterval(tick, 2000);
    return () => clearInterval(i);
  }, [rootId, participantsOverride]);

  // Participants: root author + ancestor authors + reply authors, deduped, minus
  // self. Flagged accounts (bad actors) are never suggested. When your web of
  // trust is on, we only suggest people worth connecting with — someone you
  // follow or with real standing in YOUR network — so random bots don't get a
  // "Follow" nudge; but we fall back to the full list rather than show nobody.
  const participants = useMemo(() => {
    const ordered = [rootEvent.pubkey, ...(ancestors ?? []).map((a) => a.pubkey), ...replyPks];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const pk of ordered) {
      if (!pk || pk === myPubkey || seen.has(pk)) continue;
      seen.add(pk);
      if (isAuthorFlagged(pk)) continue;
      out.push(pk);
    }
    let list = out;
    if (!guest && wotEnabled && scores) {
      const trusted = out.filter((pk) => isFollowing(pk) || (scores.get(pk) ?? 0) >= MIN_SUGGEST_SCORE);
      if (trusted.length > 0) list = trusted;
    }
    // Unfollowed-first (logged-in only); guests keep arrival order.
    if (!guest) list = [...list].sort((a, b) => Number(isFollowing(a)) - Number(isFollowing(b)));
    return list;
  }, [rootEvent.pubkey, ancestors, replyPks, myPubkey, guest, isFollowing, scores, wotEnabled, isAuthorFlagged]);

  // More from the root author (logged-in only — uses the authed feed API).
  useEffect(() => {
    if (guest) return;
    let cancelled = false;
    fetchUserNotesPaginated(rootEvent.pubkey, Math.floor(Date.now() / 1000), 12)
      .then((res) => {
        if (cancelled || !res.ok) return;
        const others = res.events
          .filter((e) => e.id !== rootId && !e.tags.some((t) => t[0] === "e"))
          .slice(0, 3);
        setMore(others);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [rootEvent.pubkey, rootId, guest]);

  const authorName = useMemo(() => {
    const p = (eventStore.getReplaceable?.(KIND_METADATA, rootEvent.pubkey) ?? null) as Event | null;
    return p ? getDisplayName(p) : "this author";
  }, [rootEvent.pubkey]);

  const share = useCallback(async () => {
    // Outward link carries hints + author (share-links.ts); the in-app
    // noteHref stays hint-less — internal navigation reads the local store.
    const url = `${window.location.origin}/thread/${noteShareId(rootId, rootEvent.pubkey, getEventRelays(rootId))}`;
    try {
      if (navigator.share) { await navigator.share({ url, title: "Conversation on Relay Outpost" }); return; }
    } catch { /* user cancelled — fall through to copy */ }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: "Share this conversation anywhere." });
    } catch {
      toast({ title: "Couldn't copy", description: url, variant: "destructive" });
    }
  }, [rootId, rootEvent.pubkey, toast]);

  const shownPeople = showAll ? participants : participants.slice(0, PEOPLE_CAP);
  // A lone post with no replies isn't a "thread of people" — showing just the
  // author is noise. Only surface the row once there's an actual conversation
  // (more than one voice, or at least one reply).
  const hasPeople = participants.length > 1 || (participants.length >= 1 && replyPks.length > 0);
  const hasMore = !guest && more.length > 0;

  // Nothing worth showing (e.g. a solo post with no other content) — stay out of the way.
  if (!hasPeople && !hasMore) {
    return (
      <div className="mt-4 flex justify-center">
        <Button variant="outline" size="sm" onClick={share} className="gap-2 text-xs" data-testid="thread-share">
          <Share2 className="w-3.5 h-3.5" /> Share this conversation
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-4" data-testid="thread-end-block">
      {guest && (
        <div className="flex items-center gap-2 rounded-lg bg-primary/[0.06] border border-primary/15 px-3 py-2">
          <MessageSquarePlus className="w-4 h-4 text-brand shrink-0" />
          <span className="text-xs text-muted-foreground flex-1">Sign in to follow these people, reply, and zap.</span>
          <Button size="sm" onClick={signIn} className="h-7 text-xs shrink-0" data-testid="thread-guest-signin">Sign in</Button>
        </div>
      )}

      {hasPeople && (
        <section>
          <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            <Users className="w-3.5 h-3.5" /> People in this thread
          </div>
          <div className="flex flex-wrap gap-2">
            {shownPeople.map((pk) => (
              <PersonChip key={pk} pubkey={pk} guest={guest} onSignIn={signIn} />
            ))}
          </div>
          {participants.length > PEOPLE_CAP && !showAll && (
            <button onClick={() => setShowAll(true)} className="mt-2 text-[11px] text-brand hover:underline" data-testid="thread-people-all">
              See all {participants.length}
            </button>
          )}
        </section>
      )}

      {hasMore && (
        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            More from {authorName}
          </div>
          <div className="flex flex-col gap-1.5">
            {more.map((n) => (
              <button
                key={n.id}
                onClick={() => navigate(noteHref(n.id))}
                className="text-left rounded-lg border border-border/40 bg-card/60 hover:bg-muted/30 px-3 py-2 transition-colors"
                data-testid={`thread-more-${n.id.slice(0, 8)}`}
              >
                <p className="text-sm text-foreground/90 line-clamp-2">{n.content.replace(/\s+/g, " ").trim() || "(media post)"}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{relTime(n.created_at)}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="flex justify-center pt-1">
        <Button variant="outline" size="sm" onClick={share} className="gap-2 text-xs" data-testid="thread-share">
          <Share2 className="w-3.5 h-3.5" /> Share this conversation
        </Button>
      </div>
    </div>
  );
}
