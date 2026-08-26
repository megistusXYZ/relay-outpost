import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { Link, useLocation } from "wouter";
import { use$ } from "applesauce-react/hooks";
import { eventStore, pool, publishEvent, fetchProfilesCached, FAST_RELAYS, throttledPoolSubscribe } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import { prefetchProfileOnHover } from "@/hooks/use-prefetch-visible";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { BarChart3, Clock, CheckCircle2, Users, AlertCircle, MessageSquare, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { signWithTimeout } from "@/lib/signer-timeout";
import { getAvatarUrl, getDisplayName, getProfileContent, KIND_METADATA, formatNpub, formatNoteId, clientTags } from "@/lib/nostr-helpers";
import { TrustTierDot, AuthorHoverCard } from "./nostr-post/author-hover";
import { PostBadgeIcons } from "@/components/BadgeDisplay";
import { Nip05VerifiedCheck } from "@/components/Nip05Badge";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { InlineThreadReplyBar } from "./nostr-post/thread";
import { TextWithUnresolvedNostr } from "@/components/NostrPost";
import { KIND_POLL, KIND_POLL_RESPONSE } from "@/lib/polls";
import { extractMediaFromContent } from "@/lib/media-utils";
import { ImageLightbox } from "@/components/ImageLightbox";

interface PollOption {
  index: string;
  label: string;
}

function parsePollOptions(event: Event): PollOption[] {
  const options: PollOption[] = [];
  for (const tag of event.tags) {
    if (tag[0] === "option" && tag[1] !== undefined && tag[2] !== undefined) {
      options.push({ index: tag[1], label: tag[2] });
    }
  }
  return options;
}

function getPollExpiration(event: Event): number | null {
  const expirationTag = event.tags.find(t => t[0] === "expiration" && t[1]);
  if (expirationTag) {
    const ts = parseInt(expirationTag[1], 10);
    if (!isNaN(ts)) return ts;
  }
  return null;
}

function isPollExpired(event: Event): boolean {
  const expiration = getPollExpiration(event);
  if (!expiration) return false;
  return Math.floor(Date.now() / 1000) > expiration;
}

function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "Closed";
  const days = Math.floor(secondsLeft / 86400);
  const hours = Math.floor((secondsLeft % 86400) / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  const seconds = secondsLeft % 60;
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  if (minutes > 0) return `${minutes}m ${seconds}s left`;
  return `${seconds}s left`;
}

function formatExactEndTime(expiration: number): string {
  try {
    const d = new Date(expiration * 1000);
    return `Ends ${d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}`;
  } catch {
    return "";
  }
}

function usePollCountdown(expiration: number | null): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!expiration) return;
    let timeoutId: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const current = Math.floor(Date.now() / 1000);
      setNow(current);
      const remaining = expiration - current;
      if (remaining <= 0) return;
      const delay = remaining > 3600 ? Math.min(60000, (remaining - 3600) * 1000) : 1000;
      timeoutId = setTimeout(schedule, delay);
    };
    const initialRemaining = expiration - Math.floor(Date.now() / 1000);
    if (initialRemaining <= 0) return;
    const initialDelay = initialRemaining > 3600 ? Math.min(60000, (initialRemaining - 3600) * 1000) : 1000;
    timeoutId = setTimeout(schedule, initialDelay);
    return () => clearTimeout(timeoutId);
  }, [expiration]);
  return now;
}

const MAX_VOTER_AVATARS = 3;

function VoterAvatars({ pubkeys }: { pubkeys: string[] }) {
  if (pubkeys.length === 0) return null;
  const shown = pubkeys.slice(0, MAX_VOTER_AVATARS);

  return (
    <div className="flex -space-x-1.5">
      {shown.map((pk) => (
        <VoterAvatar key={pk} pubkey={pk} />
      ))}
    </div>
  );
}

function VoterAvatar({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const url = getAvatarUrl(profile);
  const name = useMemo(() => getDisplayName(profile, ""), [profile]);

  return (
    <Avatar className="w-5 h-5 border border-background shrink-0">
      <AvatarImage src={url} alt={name} />
      <AvatarFallback className="text-[7px] bg-muted text-muted-foreground">
        {name.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

function PollInlineMedia({ content }: { content: string }) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const { text, media } = useMemo(() => extractMediaFromContent(content), [content]);

  const images = useMemo(() => media.filter(m => m.type === "image"), [media]);
  const videos = useMemo(() => media.filter(m => m.type === "video"), [media]);

  if (images.length === 0 && videos.length === 0) {
    return (
      <div className="text-base sm:text-sm leading-[1.85] font-medium mb-4 break-words overflow-hidden whitespace-pre-wrap">
        <TextWithUnresolvedNostr text={content} />
      </div>
    );
  }

  return (
    <div className="mb-4">
      {text && (
        <div className="text-base sm:text-sm leading-[1.85] font-medium mb-3 break-words overflow-hidden whitespace-pre-wrap">
          <TextWithUnresolvedNostr text={text} />
        </div>
      )}
      {images.length > 0 && (
        <div className={`grid gap-2 mb-2 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {images.map((img, i) => (
            <div
              key={img.url}
              className="rounded-lg overflow-hidden bg-muted/30 cursor-pointer ring-1 ring-border/20 dark:ring-primary/10"
              onClick={(e) => { e.stopPropagation(); setLightboxUrl(img.url); }}
            >
              <img
                src={img.url}
                alt=""
                className="w-full max-h-[300px] object-cover"
                loading="lazy"
              />
            </div>
          ))}
        </div>
      )}
      {videos.map((vid) => (
        <div key={vid.url} className="rounded-lg overflow-hidden bg-muted/30 ring-1 ring-border/20 dark:ring-primary/10 mb-2">
          <video
            src={vid.url}
            controls
            preload="metadata"
            playsInline
            className="w-full max-h-[400px]"
          />
        </div>
      ))}
      {lightboxUrl && (
        <ImageLightbox
          images={[{ src: lightboxUrl }]}
          onClose={() => setLightboxUrl(null)}
          testIdPrefix="poll-lightbox"
        />
      )}
    </div>
  );
}

interface PollPostProps {
  event: Event;
}

export const PollPost = memo(function PollPost({ event }: PollPostProps) {
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [responses, setResponses] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [userVote, setUserVote] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [replies, setReplies] = useState<Event[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const repliesFetchedRef = useRef(false);
  const prevPubkeyRef = useRef(pubkey);
  const grapeRankScores = useGrapeRankScores();

  const authorProfile = use$(() => eventStore.replaceable(KIND_METADATA, event.pubkey), [event.pubkey]);
  const displayName = useMemo(() => getDisplayName(authorProfile, ""), [authorProfile]);
  const avatarUrl = getAvatarUrl(authorProfile);
  const profileUrl = useMemo(() => {
    try { return `/profile/${nip19.npubEncode(event.pubkey)}`; } catch { return "#"; }
  }, [event.pubkey]);

  const authorNip05 = useMemo(() => {
    if (!authorProfile) return null;
    const content = getProfileContent(authorProfile);
    return content?.nip05 || null;
  }, [authorProfile]);

  const noteId = useMemo(() => formatNoteId(event.id), [event.id]);
  const threadUrl = `/thread/${noteId}`;

  // Same tap-to-open-thread behavior as regular NostrPost cards: neutral areas
  // of the card navigate to the poll's own thread page, while anything
  // interactive (vote options, links, the Comments toggle, badges marked
  // data-no-navigate) is guarded out via closest().
  const handleCardClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (target.closest("a, button, textarea, input, select, label, video, iframe, [role='menuitem'], [role='button'], [role='link'], [role='dialog'], [data-radix-popper-content-wrapper], [data-radix-dropdown-menu-trigger], [data-radix-collection-item], [data-no-navigate]")) return;
    const sel = window.getSelection();
    if (sel && sel.toString() && sel.anchorNode && (e.currentTarget as HTMLElement).contains(sel.anchorNode)) return;
    navigate(threadUrl);
  }, [navigate, threadUrl]);

  const options = useMemo(() => parsePollOptions(event), [event]);
  const question = event.content;
  const expiration = useMemo(() => getPollExpiration(event), [event]);
  const nowTick = usePollCountdown(expiration);
  const expired = expiration !== null && nowTick >= expiration;
  const secondsLeft = expiration ? Math.max(0, expiration - nowTick) : 0;
  const isUrgent = !expired && expiration !== null && secondsLeft > 0 && secondsLeft < 3600;
  const timeAgo = useMemo(() => {
    try { return formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true }); }
    catch { return ""; }
  }, [event.created_at]);
  const expiresLabel = useMemo(() => {
    if (!expiration) return null;
    if (expired) return "Closed";
    return formatCountdown(secondsLeft);
  }, [expiration, expired, secondsLeft]);
  const expiresTitle = useMemo(
    () => (expiration ? formatExactEndTime(expiration) : ""),
    [expiration],
  );

  useEffect(() => {
    fetchProfilesCached([event.pubkey]);
  }, [event.pubkey]);

  useEffect(() => {
    if (!pubkey) {
      setUserVote(null);
      return;
    }
    const myResponse = responses.find(r => r.pubkey === pubkey);
    if (myResponse) {
      const responseTag = myResponse.tags.find(t => t[0] === "response" || t[0] === "poll_option");
      if (responseTag) {
        setUserVote(responseTag[1]);
        return;
      }
    }
    try {
      const saved = localStorage.getItem(`poll_vote_${event.id}_${pubkey}`);
      if (saved !== null) {
        setUserVote(saved);
        return;
      }
    } catch {}
    setUserVote(null);
  }, [pubkey, responses, event.id]);

  useEffect(() => {
    let cancelled = false;
    const relays = FAST_RELAYS.slice(0, 4);
    const collected: Event[] = [];

    const sub = throttledPoolSubscribe(relays, { kinds: [KIND_POLL_RESPONSE], "#e": [event.id] }, {
      onevent(resp: Event) {
        if (resp.kind === KIND_POLL_RESPONSE) {
          collected.push(resp);
        }
      },
      oneose() {
        if (cancelled) return;
        const deduped = new Map<string, Event>();
        for (const r of collected) {
          const existing = deduped.get(r.pubkey);
          if (!existing || r.created_at > existing.created_at) {
            deduped.set(r.pubkey, r);
          }
        }
        const uniqueResponses = Array.from(deduped.values());
        setResponses(uniqueResponses);

        const voterPubkeys = uniqueResponses.map(r => r.pubkey);
        if (voterPubkeys.length > 0) fetchProfilesCached(voterPubkeys.slice(0, 30));

        if (pubkey) {
          const myResponse = uniqueResponses.find(r => r.pubkey === pubkey);
          if (myResponse) {
            const responseTag = myResponse.tags.find(t => t[0] === "response" || t[0] === "poll_option");
            if (responseTag) {
              setUserVote(responseTag[1]);
              try { localStorage.setItem(`poll_vote_${event.id}_${pubkey}`, responseTag[1]); } catch {}
            }
          }
        }

        setLoading(false);
      },
    });

    return () => { cancelled = true; sub.close(); };
  }, [event.id, pubkey]);

  const votersByOption = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const opt of options) {
      map.set(opt.index, []);
    }
    for (const resp of responses) {
      const responseTag = resp.tags.find(t => t[0] === "response" || t[0] === "poll_option");
      if (responseTag && map.has(responseTag[1])) {
        map.get(responseTag[1])!.push(resp.pubkey);
      }
    }
    return map;
  }, [responses, options]);

  const voteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const opt of options) {
      counts.set(opt.index, votersByOption.get(opt.index)?.length || 0);
    }
    return counts;
  }, [votersByOption, options]);

  const totalVotes = useMemo(() => {
    let total = 0;
    voteCounts.forEach(v => { total += v; });
    return total;
  }, [voteCounts]);

  const trustedVoteCount = useMemo(() => {
    if (!grapeRankScores || !grapeRankScores.scores || grapeRankScores.scores.size === 0) return null;
    let trusted = 0;
    for (const resp of responses) {
      const influence = grapeRankScores.getAuthorInfluence(resp.pubkey);
      if (influence !== null && influence > 0) {
        trusted++;
      }
    }
    return trusted;
  }, [responses, grapeRankScores]);

  const hasVoted = userVote !== null;
  const showResults = hasVoted || expired;

  const handleVote = useCallback(async (optionIndex: string) => {
    if (!signer || !pubkey) {
      toast({ title: "Sign in required", description: "Sign in to vote on polls.", variant: "destructive" });
      return;
    }
    if (hasVoted || expired || voting) return;

    setVoting(true);
    try {
      const eventTemplate = {
        kind: KIND_POLL_RESPONSE,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", event.id],
          ["p", event.pubkey],
          ["response", optionIndex],
          ...clientTags(),
        ],
        content: "",
      };

      let signed: Event | null = null;
      try {
        signed = await signWithTimeout(signer, eventTemplate);
      } catch {
        toast({ title: "Signing failed", description: "Could not sign the vote.", variant: "destructive" });
        setVoting(false);
        return;
      }
      if (!signed) {
        toast({ title: "Signing failed", description: "Could not sign the vote.", variant: "destructive" });
        setVoting(false);
        return;
      }

      const { relays: publishRelays } = getPublishTarget();
      const success = await publishEvent(signed, publishRelays.length > 0 ? publishRelays : FAST_RELAYS);
      if (success) {
        setUserVote(optionIndex);
        try { localStorage.setItem(`poll_vote_${event.id}_${pubkey}`, optionIndex); } catch {}
        setResponses(prev => [...prev, signed]);
        toast({ title: "Vote cast", description: "Your vote has been published." });
      } else {
        toast({ title: "Failed", description: "Could not publish vote.", variant: "destructive" });
      }
    } catch (err) {
      console.error("Vote failed:", err);
      toast({ title: "Error", description: "Something went wrong.", variant: "destructive" });
    } finally {
      setVoting(false);
    }
  }, [signer, pubkey, hasVoted, expired, voting, event.id, event.pubkey, toast]);

  const toggleComments = useCallback(() => {
    const next = !showComments;
    setShowComments(next);
    if (next && !repliesFetchedRef.current) {
      repliesFetchedRef.current = true;
      setRepliesLoading(true);
      const relays = FAST_RELAYS.slice(0, 4);
      const collected: Event[] = [];
      const sub = throttledPoolSubscribe(relays, { kinds: [1], "#e": [event.id], limit: 30 }, {
        onevent(r: Event) {
          collected.push(r);
        },
        oneose() {
          const unique = Array.from(new Map(collected.map(e => [e.id, e])).values());
          unique.sort((a, b) => b.created_at - a.created_at);
          setReplies(unique);
          setRepliesLoading(false);
          const pubkeys = [...new Set(unique.map(r => r.pubkey))];
          if (pubkeys.length > 0) fetchProfilesCached(pubkeys.slice(0, 20));
        },
      });
    }
  }, [showComments, event.id]);

  const accentClass = hasVoted
    ? "bg-green-500/70"
    : expired
    ? "bg-muted-foreground/30"
    : "bg-gradient-to-b from-brand via-brand/80 to-brand/80";

  return (
    <div className="overflow-visible feed-post-item" data-event-id={event.id}>
      <Card className="relative overflow-visible glass-card">
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full z-[2] ${accentClass}`}
        />
        <article data-testid={`poll-${event.id}`} onClick={handleCardClick} className="cursor-pointer">
          <div className="flex items-center gap-2.5 sm:gap-3 glass-header rounded-t-xl px-3.5 sm:px-5 pt-3.5 sm:pt-4 pb-2.5 sm:pb-3">
            <AuthorHoverCard pubkey={event.pubkey} profile={authorProfile}>
              <Link href={profileUrl} data-testid={`link-poll-avatar-${event.id}`} onMouseEnter={() => prefetchProfileOnHover(event.pubkey)}>
                <Avatar className="w-9 h-9 shrink-0 ring-2 ring-primary/30 border-2 border-background cursor-pointer">
                  <AvatarImage src={avatarUrl} alt={displayName} />
                  <AvatarFallback className="bg-brand/10 text-brand font-bold text-xs">
                    {displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Link>
            </AuthorHoverCard>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <Link href={profileUrl} data-testid={`link-poll-author-${event.id}`} className="min-w-0 shrink">
                  <span className="font-bold block truncate cursor-pointer text-foreground tracking-tight text-base sm:text-sm" data-testid={`text-poll-author-name-${event.id}`}>
                    {displayName}
                  </span>
                </Link>
                <TrustTierDot pubkey={event.pubkey} />
                <PostBadgeIcons pubkey={event.pubkey} />
                {authorNip05 && (
                  <>
                    <span className="text-muted-foreground/30 select-none hidden sm:inline shrink-0">|</span>
                    <Nip05VerifiedCheck nip05={authorNip05} pubkey={event.pubkey} className="w-3 h-3 sm:w-3.5 sm:h-3.5 hidden sm:inline-block" />
                  </>
                )}
              </div>
              <span className="text-[11px] text-brand/50 dark:text-muted-foreground/70 block sm:hidden mt-0.5">
                {timeAgo}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {hasVoted ? (
                <Badge variant="secondary" data-no-navigate className="text-[10px] px-2 py-0.5 bg-green-500/15 text-green-500 border-green-500/30 gap-1 font-semibold">
                  <CheckCircle2 className="w-3 h-3" />
                  Voted
                </Badge>
              ) : (
                <Badge variant="secondary" data-no-navigate className="text-[10px] px-2 py-0.5 bg-brand/15 text-brand border-brand/30 gap-1 font-semibold">
                  <BarChart3 className={`w-3 h-3 ${expired ? "" : "animate-pulse motion-reduce:animate-none"}`} />
                  {expired ? "Closed" : "Poll"}
                </Badge>
              )}
              <span className="text-xs sm:text-[11px] text-brand/60 dark:text-muted-foreground/80 whitespace-nowrap hidden sm:inline">
                {timeAgo}
              </span>
            </div>
          </div>

          <div className="mx-5 sm:mx-8 mt-5 mb-4 sm:mb-5">
            <div className="rounded-xl glass-inner px-3 sm:px-4 py-3 sm:py-4 overflow-hidden">
              {question && (
                <div data-testid={`text-poll-question-${event.id}`}>
                  <PollInlineMedia content={question} />
                </div>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <RelayOutpostInlineLoader className="w-5 h-5 text-brand/50" />
                </div>
              ) : (
                <div className="space-y-2" data-testid={`container-poll-options-${event.id}`}>
                  {options.map((opt) => {
                    const count = voteCounts.get(opt.index) || 0;
                    const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                    const isMyVote = userVote === opt.index;
                    const isWinning = showResults && totalVotes > 0 && count === Math.max(...Array.from(voteCounts.values()));
                    const voters = votersByOption.get(opt.index) || [];

                    return (
                      <button
                        key={opt.index}
                        onClick={(e) => { e.stopPropagation(); handleVote(opt.index); }}
                        disabled={hasVoted || expired || voting || !pubkey}
                        className={`w-full relative rounded-lg border-2 transition-all duration-200 text-left overflow-hidden group ${
                          isMyVote
                            ? "border-brand/60 bg-brand/10 ring-1 ring-brand/20"
                            : hasVoted || expired
                            ? "border-border/20 bg-transparent opacity-60"
                            : "border-brand/20 hover:border-brand/40 hover:bg-brand/5 cursor-pointer"
                        }`}
                        data-testid={`button-poll-option-${opt.index}-${event.id}`}
                      >
                        {showResults && (
                          <div
                            className={`absolute inset-y-0 left-0 rounded-lg transition-all duration-500 ${
                              isMyVote
                                ? "bg-brand/25 dark:bg-brand/30"
                                : isWinning
                                ? "bg-brand/15 dark:bg-brand/20"
                                : "bg-muted-foreground/10 dark:bg-muted-foreground/15"
                            }`}
                            style={{ width: `${percentage}%` }}
                          />
                        )}
                        <div className="relative flex items-center justify-between px-3 py-2.5 sm:py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {isMyVote && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-brand shrink-0" />
                            )}
                            <span className={`text-sm sm:text-xs ${isMyVote ? "font-semibold text-brand" : "text-foreground/80"}`}>
                              {opt.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            {hasVoted && voters.length > 0 && (
                              <VoterAvatars pubkeys={voters} />
                            )}
                            {showResults && (
                              <>
                                <span className={`text-xs font-mono ${isMyVote || isWinning ? "text-brand font-bold" : "text-muted-foreground"}`}>
                                  {percentage}%
                                </span>
                                <span className="text-[10px] text-muted-foreground/60">
                                  ({count})
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/20">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
                    <Users className="w-3 h-3" />
                    <span>{totalVotes} vote{totalVotes !== 1 ? "s" : ""}</span>
                  </div>
                  {trustedVoteCount !== null && trustedVoteCount > 0 && (
                    <div className="flex items-center gap-1 text-[11px] text-green-500/60" title="Votes from accounts in your trust network">
                      <ShieldCheck className="w-3 h-3" />
                      <span>{trustedVoteCount} trusted</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {expiresLabel && (
                    <div
                      title={expiresTitle || undefined}
                      className={`flex items-center gap-1 text-[11px] tabular-nums whitespace-nowrap ${
                        expired
                          ? "text-red-700/70 dark:text-red-400/70"
                          : isUrgent
                          ? "text-red-700/90 dark:text-red-400/90 font-semibold"
                          : "text-amber-500/70"
                      }`}
                    >
                      {expired ? (
                        <AlertCircle className="w-3 h-3" />
                      ) : (
                        <Clock
                          className={`w-3 h-3 ${
                            isUrgent ? "animate-pulse motion-reduce:animate-none" : ""
                          }`}
                        />
                      )}
                      <span>{expiresLabel}</span>
                    </div>
                  )}
                  {voting && (
                    <RelayOutpostInlineLoader className="w-3 h-3 text-brand" />
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-border/15">
            <button
              onClick={(e) => { e.stopPropagation(); toggleComments(); }}
              className="flex items-center gap-1.5 px-5 py-2 text-[11px] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors w-full"
            >
              <MessageSquare className="w-3 h-3" />
              <span>Comments</span>
              {hasVoted && replies.length > 0 && (
                <span className="text-[10px] text-brand/60">({replies.length})</span>
              )}
              {showComments ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
            </button>

            {showComments && (
              <div className="border-t border-border/10">
                {repliesLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <RelayOutpostInlineLoader className="w-4 h-4 text-brand/40" />
                  </div>
                ) : replies.length > 0 ? (
                  <div className="max-h-[300px] overflow-y-auto">
                    {replies.slice(0, 10).map((reply) => (
                      <PollComment key={reply.id} event={reply} />
                    ))}
                    {replies.length > 10 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(threadUrl); }}
                        className="w-full px-5 py-2 text-[10px] text-brand/70 hover:text-brand-strong text-center transition-colors"
                        data-testid={`button-poll-view-thread-${event.id}`}
                      >
                        View all {replies.length} comments in thread
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="px-5 py-3 text-[11px] text-muted-foreground/40 text-center">
                    No comments yet
                  </div>
                )}
                <InlineThreadReplyBar replyTo={event} />
              </div>
            )}
          </div>
        </article>
      </Card>
    </div>
  );
}, (prev, next) => prev.event.id === next.event.id);

function PollComment({ event }: { event: Event }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, event.pubkey), [event.pubkey]);
  const name = useMemo(() => getDisplayName(profile, ""), [profile]);
  const avatar = getAvatarUrl(profile);
  const timeAgo = useMemo(() => {
    try { return formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true }); }
    catch { return ""; }
  }, [event.created_at]);
  const profileUrl = useMemo(() => {
    try { return `/profile/${nip19.npubEncode(event.pubkey)}`; } catch { return "#"; }
  }, [event.pubkey]);

  return (
    <div className="flex gap-2.5 px-4 sm:px-5 py-2.5 border-b border-border/10 last:border-b-0">
      <Link href={profileUrl}>
        <Avatar className="w-6 h-6 shrink-0 border border-border/30 cursor-pointer">
          <AvatarImage src={avatar} alt={name} />
          <AvatarFallback className="text-[8px] bg-muted text-muted-foreground">
            {name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Link href={profileUrl}>
            <span className="text-xs font-semibold text-foreground/80 truncate cursor-pointer hover:underline">{name}</span>
          </Link>
          <TrustTierDot pubkey={event.pubkey} />
          <span className="text-[10px] text-muted-foreground/40">{timeAgo}</span>
        </div>
        <p className="text-xs text-foreground/70 leading-relaxed mt-0.5 break-words whitespace-pre-wrap">
          {event.content.length > 280 ? event.content.slice(0, 280) + "..." : event.content}
        </p>
      </div>
    </div>
  );
}
