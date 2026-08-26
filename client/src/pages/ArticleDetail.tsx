import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { use$ } from "applesauce-react/hooks";
import { eventStore, pool, DEFAULT_RELAYS, FAST_RELAYS, fetchProfiles, publishEvent, throttledPoolSubscribe } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import { KIND_LONG_FORM, decodeNaddr, parseArticle, estimateReadingTime } from "@/lib/nip23";
import { fetchPrimalArticles } from "@/lib/primal-cache";
import { getAvatarUrl, getDisplayName, getRealName, formatNpub, shortenNpub, getProfileContent, clientTags } from "@/lib/nostr-helpers";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { createShareMention } from "@/lib/share-mention";
import { RelayOutpostLoader, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link, useParams } from "wouter";
import { useGoBack } from "@/hooks/use-go-back";
import { nip19 } from "nostr-tools";
import { formatDistanceToNow, format } from "date-fns";
// The markdown pipeline (sanitize schemas, style-attr scrubbing, nostr-embed
// remark plugin, video/iframe/nostr-embed overrides) lives in the shared
// ArticleMarkdown component so GuestArticlePreview renders identically.
import { ArticleMarkdown } from "@/components/ArticleMarkdown";
import {
  ArrowLeft,
  Clock,
  Calendar,
  Hash,
  Share2,
  Copy,
  ExternalLink,
  BookOpen,
  AudioLines,
  Send,
  Bookmark,
  BookmarkCheck,
  MessageSquare,
  MessageSquareOff,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle } from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useNostrBookmarks } from "@/hooks/use-nostr-bookmarks";
import { useTTS } from "@/contexts/TextToSpeechContext";
import { ZapDialog } from "@/components/ZapDialog";
import { BtcZapIcon } from "@/components/NostrPost";
import type { Event } from "nostr-tools";
import type { ArticleData } from "@/lib/nip23";
import { useDocumentTitle } from "@/hooks/use-document-title";

const KIND_TEXT_NOTE = 1;


function ShareArticleToNostrDialog({ article, onClose }: { article: ArticleData; onClose: () => void }) {
  const { pubkey, signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const [isPublishing, setIsPublishing] = useState(false);

  const articleUrl = `${window.location.origin}/articles/${article.naddr}`;
  // Show the author's profile name in the editable prefill (raw npubs are
  // user-hostile); the mention is swapped back to a nostr:npub token at
  // publish time so other clients render a tappable @mention.
  const authorProfile = use$(() => eventStore.replaceable(0, article.event.pubkey), [article.event.pubkey]);
  const fallbackName = shortenNpub(formatNpub(article.event.pubkey));
  // Real name on purpose: this string is prefilled into a PUBLISHED post.
  const authorName = authorProfile ? (getRealName(authorProfile, fallbackName) ?? fallbackName) : fallbackName;
  const authorMention = useMemo(() => createShareMention(article.event.pubkey, authorName), [article.event.pubkey, authorName]);
  const defaultContent = `${article.title}${article.summary ? `\n\n${article.summary.slice(0, 200)}${article.summary.length > 200 ? "..." : ""}` : ""}${authorMention ? `\n\nby ${authorMention.display}` : ""}\n\n${articleUrl}`;
  const [content, setContent] = useState(defaultContent);
  const userEditedRef = useRef(false);

  // Refresh the prefill if the author's profile finishes loading after mount,
  // but never clobber text the user has already edited.
  useEffect(() => {
    if (!userEditedRef.current) setContent(defaultContent);
  }, [defaultContent]);

  const handleShare = async () => {
    if (!signer || !pubkey) {
      toast({ title: "Not signed in", description: "Sign in to share.", variant: "destructive" });
      return;
    }
    if (!content.trim()) return;

    setIsPublishing(true);
    try {
      const tags: string[][] = [];
      tags.push(["p", article.event.pubkey]);

      if (article.hashtags.length > 0) {
        article.hashtags.forEach((t) => tags.push(["t", t.toLowerCase()]));
      }

      tags.push(["r", articleUrl]);

      if (article.image) {
        tags.push(["r", article.image]);
      }
      tags.push(...clientTags());

      const eventTemplate = {
        kind: KIND_TEXT_NOTE,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: (authorMention ? authorMention.resolve(content) : content).trim() };

      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      publishEvent(signedEvent, userRelays, undefined, isUserSelected).catch((err) => {
        console.error("Background publish failed:", err);
      });
      toast({ title: "Shared", description: "Article posted." });
      onClose();
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else {
        console.error("Failed to share article:", err);
        toast({ title: "Failed to share", description: "Something went wrong.", variant: "destructive" });
      }
      setIsPublishing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-brand/[0.06] border border-brand/15 p-3 overflow-hidden">
        {article.image && (
          <div className="rounded-md overflow-hidden mb-2 max-h-32 bg-muted/20">
            <img src={article.image} alt="" className="w-full h-full object-cover max-h-32" loading="lazy" decoding="async" />
          </div>
        )}
        <p className="text-[10px] text-brand/60 font-mono uppercase tracking-wider mb-1.5">Sharing Article</p>
        <p className="text-sm font-medium text-foreground/90 line-clamp-2 break-words">{article.title}</p>
        {article.summary && (
          <p className="text-[11px] text-muted-foreground/60 mt-1 line-clamp-2 break-words">{article.summary}</p>
        )}
        <p className="text-[11px] text-muted-foreground/50 mt-1.5 break-all line-clamp-1">{articleUrl}</p>
      </div>

      <Textarea
        value={content}
        onChange={(e) => { userEditedRef.current = true; setContent(e.target.value); }}
        rows={5}
        className="text-sm resize-none bg-white/[0.04] border-white/[0.08] focus:border-brand/30 focus:bg-white/[0.06] rounded-lg break-words"
        style={{ fontSize: 16, wordBreak: "break-word", overflowWrap: "break-word" }}
        placeholder="Add your thoughts..."
        autoComplete="off"
        data-testid="textarea-share-article-content"
      />

      <p className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-wider leading-relaxed">
        This creates a public post with the article link. Others can reply and zap your post.
      </p>

      <div className="flex gap-2.5 pt-1">
        <Button
          variant="outline"
          onClick={onClose}
          className="flex-1 font-brand uppercase tracking-widest text-xs border-white/10 text-muted-foreground"
          data-testid="button-cancel-share-article"
        >
          Cancel
        </Button>
        <Button
          onClick={handleShare}
          disabled={isPublishing || !content.trim()}
          className="flex-1 bg-brand text-white font-brand uppercase tracking-widest text-xs border-0"
          data-testid="button-confirm-share-article"
        >
          {isPublishing ? (
            <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
          ) : (
            <Send className="w-3.5 h-3.5 mr-2" />
          )}
          {isPublishing ? "Posting..." : "Share"}
        </Button>
      </div>
    </div>
  );
}

function ArticleComments({ articleEvent }: { articleEvent: Event }) {
  const { pubkey, signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const [comments, setComments] = useState<Event[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [replyText, setReplyText] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, { name?: string; picture?: string }>>({});

  useEffect(() => {
    const eventId = articleEvent.id;
    if (!eventId) return;

    setComments([]);
    setLoadingComments(true);
    setProfiles({});

    const dTag = articleEvent.tags.find((t: string[]) => t[0] === "d")?.[1] || "";
    const aTagValue = `${KIND_LONG_FORM}:${articleEvent.pubkey}:${dTag}`;

    const seen = new Map<string, Event>();
    let closedCount = 0;
    const totalSubs = 2;

    const handleEvent = (evt: Event) => {
      const existing = seen.get(evt.id);
      if (!existing || evt.created_at > existing.created_at) {
        seen.set(evt.id, evt);
      }
    };

    const handleEose = (sub: { close: () => void }) => {
      sub.close();
      closedCount++;
      if (closedCount >= totalSubs) {
        const found = Array.from(seen.values()).sort((a, b) => a.created_at - b.created_at);
        setComments(found);
        setLoadingComments(false);
        const pubkeys = [...new Set(found.map((e) => e.pubkey))];
        if (pubkeys.length > 0) {
          fetchProfiles(pubkeys);
          loadCommentProfiles(pubkeys);
        }
      }
    };

    const subE = throttledPoolSubscribe(FAST_RELAYS, { kinds: [1], "#e": [eventId], limit: 100 }, {
      onevent: handleEvent,
      oneose() { handleEose(subE); } });

    const subA = throttledPoolSubscribe(FAST_RELAYS, { kinds: [1], "#a": [aTagValue], limit: 100 }, {
      onevent: handleEvent,
      oneose() { handleEose(subA); } });

    return () => {
      try { subE.close(); } catch {}
      try { subA.close(); } catch {}
    };
  }, [articleEvent.id]);

  const loadCommentProfiles = useCallback((pubkeys: string[]) => {
    const sub = throttledPoolSubscribe(FAST_RELAYS, { kinds: [0], authors: pubkeys }, {
      onevent(evt: Event) {
        try {
          const content = JSON.parse(evt.content);
          setProfiles((prev) => ({
            ...prev,
            [evt.pubkey]: { name: content.display_name || content.name, picture: content.picture } }));
        } catch {}
      },
      oneose() { sub.close(); } });
  }, []);

  const handleReply = async () => {
    if (!signer || !pubkey || !replyText.trim()) return;

    setIsPublishing(true);
    try {
      const aTag = `${KIND_LONG_FORM}:${articleEvent.pubkey}:${articleEvent.tags.find((t: string[]) => t[0] === "d")?.[1] || ""}`;
      const eventTemplate = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", articleEvent.id, "", "root"],
          ["p", articleEvent.pubkey],
          ["a", aTag],
          ...clientTags(),
        ],
        content: replyText.trim() };

      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const { relays: userRelays2, userSelected: isUserSelected2 } = getPublishTarget();
      await publishEvent(signedEvent, userRelays2, undefined, isUserSelected2);

      setComments((prev) => [...prev, signedEvent as Event]);
      setReplyText("");
      toast({ title: "Reply posted", description: "Your comment has been published." });
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else {
        console.error("Failed to post reply:", err);
        toast({ title: "Failed to post", description: "Something went wrong.", variant: "destructive" });
      }
    } finally {
      setIsPublishing(false);
    }
  };

  const getCommentProfile = (pk: string) => {
    const stored = profiles[pk];
    if (stored) return stored;
    const cached = eventStore.getReplaceable(0, pk);
    if (cached) {
      try {
        const content = JSON.parse(cached.content);
        return { name: content.display_name || content.name, picture: content.picture };
      } catch {}
    }
    return { name: undefined, picture: undefined };
  };

  return (
    <div className="border-t border-border/20 pt-5 mb-6" data-testid="container-article-comments">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="w-4 h-4 text-brand/70" />
        <h3 className="text-sm font-brand uppercase tracking-widest text-foreground/80">
          Comments {comments.length > 0 && <span className="text-muted-foreground/60 ml-1">({comments.length})</span>}
        </h3>
      </div>

      {pubkey && signer && (
        <div className="mb-5 space-y-2" data-testid="container-reply-composer">
          <Textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={3}
            className="text-sm resize-none bg-white/[0.04] border-white/[0.08] focus:border-brand/30 focus:bg-white/[0.06] rounded-lg"
            style={{ fontSize: 16 }}
            placeholder="Add a comment..."
            data-testid="textarea-article-reply"
          />
          <div className="flex justify-end">
            <Button
              onClick={handleReply}
              disabled={isPublishing || !replyText.trim()}
              size="sm"
              className="bg-brand text-white font-brand uppercase tracking-widest text-xs border-0"
              data-testid="button-post-article-reply"
            >
              {isPublishing ? (
                <RelayOutpostInlineLoader className="w-3.5 h-3.5 mr-1.5" />
              ) : (
                <Send className="w-3.5 h-3.5 mr-1.5" />
              )}
              {isPublishing ? "Posting..." : "Reply"}
            </Button>
          </div>
        </div>
      )}

      {loadingComments && (
        <div className="flex items-center justify-center py-6">
          <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
          <span className="text-xs text-muted-foreground/60">Loading comments...</span>
        </div>
      )}

      {!loadingComments && comments.length === 0 && (
        <div className="text-center py-6" data-testid="text-no-comments">
          <p className="text-xs text-muted-foreground/50">No comments yet. Be the first to share your thoughts.</p>
        </div>
      )}

      {comments.length > 0 && (
        <div className="space-y-3" data-testid="list-article-comments">
          {comments.map((comment) => {
            const profile = getCommentProfile(comment.pubkey);
            const fallbackName = shortenNpub(formatNpub(comment.pubkey));
            const name = profile.name || fallbackName;
            const avatar = profile.picture;
            const commentProfileUrl = (() => { try { return `/profile/${nip19.npubEncode(comment.pubkey)}`; } catch { return "#"; } })();

            return (
              <div
                key={comment.id}
                className="rounded-lg bg-white/[0.02] dark:bg-white/[0.02] border border-border/10 p-3"
                data-testid={`comment-${comment.id}`}
              >
                <div className="flex items-start gap-2.5">
                  <Link href={commentProfileUrl}>
                    <Avatar className="w-7 h-7 ring-1 ring-brand/15 border border-background shrink-0">
                      <AvatarImage src={avatar} alt={name} />
                      <AvatarFallback className="text-[10px] bg-brand/10 text-brand">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Link href={commentProfileUrl} className="text-xs font-medium text-foreground/80 hover:text-foreground transition-colors">{name}</Link>
                      <span className="text-[10px] text-muted-foreground/50">
                        {formatDistanceToNow(new Date(comment.created_at * 1000), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/70 whitespace-pre-wrap break-words leading-relaxed">{comment.content}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ArticleDetail() {
  const params = useParams<{ naddr: string }>();
  const goBack = useGoBack();
  const { toast } = useToast();
  const { pubkey } = useNostrAuth();
  const { isBookmarked, toggleBookmark } = useNostrBookmarks();
  const tts = useTTS();
  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState<Event | null>(null);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showZapDialog, setShowZapDialog] = useState(false);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  useEffect(() => {
    if (!params.naddr) return;

    const decoded = decodeNaddr(params.naddr);
    if (!decoded) {
      setLoading(false);
      return;
    }

    const existing = eventStore.getReplaceable(KIND_LONG_FORM, decoded.pubkey, decoded.identifier);
    if (existing) {
      setEvent(existing as Event);
      fetchProfiles([existing.pubkey]);
      setLoading(false);
      return;
    }

    let found = false;
    const filter: any = {
      kinds: [KIND_LONG_FORM],
      authors: [decoded.pubkey],
      "#d": [decoded.identifier],
      limit: 1 };

    const naddrRelays = decoded.relays.length > 0 ? decoded.relays : [];
    const relays = Array.from(new Set([...naddrRelays, ...FAST_RELAYS]));

    const sub = throttledPoolSubscribe(relays, filter, {
      onevent(evt: Event) {
        found = true;
        eventStore.add(evt);
        setEvent(evt);
        fetchProfiles([evt.pubkey]);
      },
      oneose() {
        sub.close();
        if (found) {
          setLoading(false);
          return;
        }
        fetchPrimalArticles(20, undefined, undefined, decoded.pubkey).then(({ articles }) => {
          const match = articles.find((a) => {
            const dTag = a.tags.find((t: string[]) => t[0] === "d")?.[1] || "";
            return dTag === decoded.identifier;
          });
          if (match) {
            setEvent(match);
            fetchProfiles([match.pubkey]);
          }
          setLoading(false);
        }).catch(() => {
          setLoading(false);
        });
      } });

    return () => {
      try { sub.close(); } catch {}
    };
  }, [params.naddr]);

  const article = useMemo(() => {
    if (!event) return null;
    return parseArticle(event);
  }, [event]);
  useDocumentTitle(article?.title || "Article");

  const authorProfile = use$(() =>
    event ? eventStore.replaceable(0, event.pubkey) : undefined,
    [event?.pubkey]
  );

  const displayName = useMemo(() => {
    if (!event) return "";
    const fallback = shortenNpub(formatNpub(event.pubkey));
    return authorProfile ? (getDisplayName(authorProfile, fallback) ?? fallback) : fallback;
  }, [authorProfile, event]);

  const avatarUrl = getAvatarUrl(authorProfile);

  const profileUrl = useMemo(() => {
    if (!event) return "#";
    try {
      return `/profile/${nip19.npubEncode(event.pubkey)}`;
    } catch {
      return "#";
    }
  }, [event]);

  const handleCopyLink = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: article?.title || "Article", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        toast({ title: "Link copied" });
      } catch {
        toast({ title: "Error", description: "Failed to share.", variant: "destructive" });
      }
    }
  };

  const startTTS = useCallback(() => {
    if (tts.isReading) {
      tts.stop();
    } else if (article) {
      tts.startReading(article.event.content, article.title, `/articles/${params.naddr}`);
    }
  }, [tts, article, params.naddr]);

  const articleCoord = article ? `${KIND_LONG_FORM}:${article.event.pubkey}:${article.dTag}` : "";
  const articleBookmarked = isBookmarked(articleCoord);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <RelayOutpostLoader size="lg" label="Loading article..." />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 text-center">
        <BookOpen className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground mb-4" data-testid="text-article-not-found">Article not found</p>
        <Button variant="outline" onClick={() => goBack("/articles")} data-testid="button-back-to-articles">
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Articles
        </Button>
      </div>
    );
  }

  const readTime = estimateReadingTime(article.event.content);
  const publishDate = format(new Date(article.publishedAt * 1000), "MMMM d, yyyy");
  const timeAgo = formatDistanceToNow(new Date(article.publishedAt * 1000), { addSuffix: true });

  const articleContent = (
    <>
      {article.image && (
        <div className="aspect-[21/9] rounded-lg overflow-hidden mb-6 bg-muted/20 border border-border/20">
          <img
            src={article.image}
            alt={article.title}
            className="w-full h-full object-cover"
            data-testid="img-article-banner"
          />
        </div>
      )}

      <h1 className="hidden sm:block text-2xl sm:text-3xl font-brand font-bold mb-3 leading-tight tracking-tight text-foreground" data-testid="heading-article-title">
        {article.title}
      </h1>

      {article.summary && (
        <p className="hidden sm:block text-sm sm:text-base text-muted-foreground/80 mb-5 leading-relaxed" data-testid="text-article-summary">
          {article.summary}
        </p>
      )}

      <div className="hidden sm:flex flex-col sm:flex-row sm:items-center gap-3 mb-6 pb-6 border-b border-border/20">
        <Link href={profileUrl} className="flex items-center gap-2.5 shrink-0">
          <Avatar className="w-9 h-9 ring-1 ring-brand/20 border border-background">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback className="text-xs bg-brand/10 text-brand">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground/90" data-testid="text-author-name">{displayName}</span>
            <span className="text-[11px] text-muted-foreground/60">{timeAgo}</span>
          </div>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3 sm:ml-auto flex-wrap">
          <span className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
            <Calendar className="w-3 h-3" /> {publishDate}
          </span>
          <span className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
            <Clock className="w-3 h-3" /> {readTime} min read
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={startTTS}
            data-testid="button-listen-article"
          >
            <AudioLines className={`w-4 h-4 ${tts.isReading ? "text-brand" : ""}`} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="button-share-article">
                <Share2 className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {pubkey && (
                <DropdownMenuItem onClick={() => setShowShareDialog(true)} data-testid="menu-item-share-nostr">
                  <Send className="w-3.5 h-3.5 mr-2" /> Share
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleCopyLink} data-testid="menu-item-copy-link">
                <Copy className="w-3.5 h-3.5 mr-2" /> Copy Link
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {pubkey && article && (() => {
            const coord = `${KIND_LONG_FORM}:${article.event.pubkey}:${article.dTag}`;
            const bookmarked = isBookmarked(coord);
            return (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => toggleBookmark(coord, "a")}
                className={bookmarked ? "text-brand" : ""}
                data-testid="button-bookmark-article-detail"
              >
                {bookmarked ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
              </Button>
            );
          })()}
          {pubkey && article && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowZapDialog(true)}
              className="text-amber-500/70 hover:text-amber-500"
              data-testid="button-zap-article-author"
            >
              <BtcZapIcon className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {article.hashtags.length > 0 && (
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap mb-6">
          {article.hashtags.map((tag) => (
            <Link key={tag} href={`/articles?tag=${encodeURIComponent(tag)}`} data-testid={`link-hashtag-${tag}`}>
              <Badge variant="secondary" className="text-[11px] cursor-pointer">
                <Hash className="w-2.5 h-2.5 mr-0.5" />{tag}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      <article className="article-prose mb-8" data-testid="container-article-content">
        <ArticleMarkdown content={article.event.content} />
      </article>

      {event && (
        event.tags.some((t: string[]) => t[0] === "comments" && t[1] === "off") ? (
          <div className="border-t border-border/20 pt-5 mb-6">
            <div className="flex items-center gap-2 text-muted-foreground/40">
              <MessageSquareOff className="w-4 h-4" />
              <p className="text-xs">Comments are closed on this post.</p>
            </div>
          </div>
        ) : (
          <ArticleComments articleEvent={event} />
        )
      )}

      <div className="hidden sm:block border-t border-border/20 pt-5 mb-6">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Link href={profileUrl} className="flex items-center gap-2">
            <Avatar className="w-7 h-7 ring-1 ring-brand/20 border border-background">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="text-[10px] bg-brand/10 text-brand">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground/70">Written by <span className="text-foreground/80 font-medium">{displayName}</span></span>
          </Link>
          <Button variant="outline" size="sm" onClick={() => goBack("/articles")} data-testid="button-back-bottom">
            <ArrowLeft className="w-3 h-3 mr-1" /> All Articles
          </Button>
        </div>
      </div>
    </>
  );

  const dialogs = (
    <>
      {article && (
        <ZapDialog
          open={showZapDialog}
          onOpenChange={setShowZapDialog}
          event={article.event}
          pubkey={article.event.pubkey}
          recipientName={displayName}
        />
      )}

      {showShareDialog && article && (
        isMobile ? (
          <Drawer open={showShareDialog} onOpenChange={(open) => { if (!open) setShowShareDialog(false); }}>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
                  <Share2 className="w-4 h-4" />
                  Share
                </DrawerTitle>
              </DrawerHeader>
              <div className="px-4 pb-6">
                <ShareArticleToNostrDialog article={article} onClose={() => setShowShareDialog(false)} />
              </div>
            </DrawerContent>
          </Drawer>
        ) : (
          <Dialog open={showShareDialog} onOpenChange={(open) => { if (!open) setShowShareDialog(false); }}>
            <DialogContent className="max-w-sm sm:max-w-md glass-dialog-card border-brand/15 overflow-hidden">
              <DialogHeader>
                <DialogTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
                  <Share2 className="w-4 h-4" />
                  Share
                </DialogTitle>
              </DialogHeader>
              <ShareArticleToNostrDialog article={article} onClose={() => setShowShareDialog(false)} />
            </DialogContent>
          </Dialog>
        )
      )}
    </>
  );

  if (isMobile) {
    return createPortal(
      <div className="fixed inset-0 z-[200] flex flex-col bg-background" data-testid="page-article-detail">
        <div className="shrink-0 bg-background border-b border-border/40" data-testid="mobile-article-header">
          <div className="flex items-center gap-2 px-4 py-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => goBack("/articles")}
              data-testid="button-back-article-mobile"
            >
              <X className="w-4 h-4" />
            </Button>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold truncate">{article.title}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted-foreground/80 truncate max-w-[150px]">{displayName}</span>
                <span className="text-[11px] text-muted-foreground/60">{timeAgo}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon" onClick={startTTS} data-testid="button-listen-article-mobile">
                <AudioLines className={`w-4 h-4 ${tts.isReading ? "text-brand" : ""}`} />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleCopyLink} data-testid="button-share-article-mobile">
                <Share2 className="w-4 h-4" />
              </Button>
              {pubkey && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowShareDialog(true)}
                  data-testid="button-share-nostr-article-mobile"
                >
                  <Send className="w-4 h-4" />
                </Button>
              )}
              {pubkey && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => toggleBookmark(articleCoord, "a")}
                  className={articleBookmarked ? "text-brand" : ""}
                  data-testid="button-bookmark-article-mobile"
                >
                  {articleBookmarked ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                </Button>
              )}
              {pubkey && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowZapDialog(true)}
                  className="text-amber-500/70"
                  data-testid="button-zap-article-mobile"
                >
                  <BtcZapIcon className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
          {tts.isReading && (
            <div className="flex flex-col border-t border-primary/20 animate-in fade-in slide-in-from-top-2 duration-200" data-testid="inline-tts-player-article">
              <div className="flex items-center gap-1 px-3 py-1.5">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {tts.isLoading ? (
                    <RelayOutpostInlineLoader className="w-3.5 h-3.5 text-brand/70 shrink-0" />
                  ) : (
                    <AudioLines className="w-3.5 h-3.5 text-brand/70 shrink-0" />
                  )}
                  <span className="text-[11px] font-medium text-foreground/80 truncate">{tts.title || "Listening..."}</span>
                </div>
                <div className="flex items-center shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={tts.skipBack} disabled={tts.isLoading} data-testid="inline-tts-back-article">
                    <SkipBack className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={tts.togglePause} disabled={tts.isLoading} data-testid="inline-tts-toggle-article">
                    {tts.isLoading ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : tts.isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={tts.skipForward} disabled={tts.isLoading} data-testid="inline-tts-forward-article">
                    <SkipForward className="w-3 h-3" />
                  </Button>
                  <button
                    className="h-7 px-1 text-[10px] font-bold tabular-nums text-brand/70 hover:text-brand transition-colors rounded"
                    onClick={() => {
                      const rates = [1, 1.25, 1.5, 1.75, 2];
                      const idx = rates.indexOf(tts.rate);
                      tts.setRate(rates[(idx + 1) % rates.length]);
                    }}
                    data-testid="inline-tts-speed-article"
                  >
                    {tts.rate}x
                  </button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-700/80 dark:text-red-400/80" onClick={tts.stop} data-testid="inline-tts-stop-article">
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <div className="w-full h-[2px] bg-primary/10">
                <div
                  className="h-full bg-primary/50 transition-[width] duration-150 ease-out"
                  style={{ width: `${tts.progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-4">
            {articleContent}
          </div>
        </div>

        {dialogs}
      </div>,
      document.body
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-6" data-testid="page-article-detail">
      <div className="flex items-center gap-2 mb-5">
        <span className="text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground/60">Articles</span>
      </div>

      {tts.isReading && (
        <div className="flex flex-col rounded-lg border border-primary/20 mb-4 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200" data-testid="inline-tts-player-article-desktop">
          <div className="flex items-center gap-1 px-3 py-1.5">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {tts.isLoading ? (
                <RelayOutpostInlineLoader className="w-3.5 h-3.5 text-brand/70 shrink-0" />
              ) : (
                <AudioLines className="w-3.5 h-3.5 text-brand/70 shrink-0" />
              )}
              <span className="text-[11px] font-medium text-foreground/80 truncate">{tts.title || "Listening..."}</span>
            </div>
            <div className="flex items-center shrink-0">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={tts.skipBack} disabled={tts.isLoading} data-testid="inline-tts-back-article-desktop">
                <SkipBack className="w-3 h-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={tts.togglePause} disabled={tts.isLoading} data-testid="inline-tts-toggle-article-desktop">
                {tts.isLoading ? <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> : tts.isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={tts.skipForward} disabled={tts.isLoading} data-testid="inline-tts-forward-article-desktop">
                <SkipForward className="w-3 h-3" />
              </Button>
              <button
                className="h-7 px-1 text-[10px] font-bold tabular-nums text-brand/70 hover:text-brand transition-colors rounded"
                onClick={() => {
                  const rates = [1, 1.25, 1.5, 1.75, 2];
                  const idx = rates.indexOf(tts.rate);
                  tts.setRate(rates[(idx + 1) % rates.length]);
                }}
                data-testid="inline-tts-speed-article-desktop"
              >
                {tts.rate}x
              </button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-700/80 dark:text-red-400/80" onClick={tts.stop} data-testid="inline-tts-stop-article-desktop">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          <div className="w-full h-[2px] bg-primary/10">
            <div
              className="h-full bg-primary/50 transition-[width] duration-150 ease-out"
              style={{ width: `${tts.progress}%` }}
            />
          </div>
        </div>
      )}

      {articleContent}

      {dialogs}
    </div>
  );
}
