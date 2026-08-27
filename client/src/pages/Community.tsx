import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams } from "wouter";
import { pool, DEFAULT_RELAYS, fetchProfilesCached, publishEvent } from "@/lib/nostr";
import { clientTags } from "@/lib/nostr-helpers";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import { ProfileLink } from "@/components/analytics/ProfileLink";
import { NostrPost } from "@/components/NostrPost";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Globe, Shield, Users, Send, BookmarkPlus, BookmarkCheck,
  FileText, ScrollText, ChevronDown, ChevronUp, Activity, Crown
} from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import {
  getDisplayName, getAvatarUrl, getProfileContent, formatNpub, shortenNpub,
  KIND_COMMUNITY
} from "@/lib/nostr-helpers";

const COMMUNITY_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
];

const KIND_COMMUNITY_POST_APPROVAL = 4550;

interface CommunityData {
  id: string;
  name: string;
  description: string;
  image?: string;
  banner?: string;
  moderators: string[];
  rules?: string;
  relays: string[];
  event: Event;
  dTag: string;
}

function parseCommunityEvent(event: Event): CommunityData | null {
  const dTag = event.tags.find(t => t[0] === "d")?.[1];
  if (!dTag) return null;
  const name = event.tags.find(t => t[0] === "name")?.[1] || dTag;
  const description = event.tags.find(t => t[0] === "description")?.[1] || "";
  const image = event.tags.find(t => t[0] === "image")?.[1];
  const banner = event.tags.find(t => t[0] === "banner")?.[1];
  const moderators = event.tags.filter(t => t[0] === "p" && t[3] === "moderator").map(t => t[1]);
  const rules = event.tags.find(t => t[0] === "rules")?.[1];
  const relays = event.tags.filter(t => t[0] === "relay").map(t => t[1]);
  return { id: event.id, name, description, image, banner, moderators, rules, relays, event, dTag };
}

function encodeCommunityNaddr(event: Event): string {
  const dTag = event.tags.find(t => t[0] === "d")?.[1] || "";
  return nip19.naddrEncode({
    kind: KIND_COMMUNITY,
    pubkey: event.pubkey,
    identifier: dTag,
    relays: [],
  });
}

function decodeCommunityNaddr(naddr: string): { kind: number; pubkey: string; identifier: string; relays: string[] } | null {
  try {
    const decoded = nip19.decode(naddr);
    if (decoded.type === "naddr") {
      return decoded.data as { kind: number; pubkey: string; identifier: string; relays: string[] };
    }
  } catch {}
  return null;
}

const FOLLOWED_COMMUNITIES_KEY = "relay_outpost_followed_communities";

function getFollowedCommunities(): string[] {
  try {
    const stored = localStorage.getItem(FOLLOWED_COMMUNITIES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function setFollowedCommunities(naddrs: string[]) {
  localStorage.setItem(FOLLOWED_COMMUNITIES_KEY, JSON.stringify(naddrs));
}

export function isFollowingCommunity(naddr: string): boolean {
  return getFollowedCommunities().includes(naddr);
}

export function toggleFollowCommunity(naddr: string): boolean {
  const current = getFollowedCommunities();
  const isFollowing = current.includes(naddr);
  if (isFollowing) {
    setFollowedCommunities(current.filter(n => n !== naddr));
    return false;
  } else {
    setFollowedCommunities([...current, naddr]);
    return true;
  }
}

export function getFollowedCommunityList(): string[] {
  return getFollowedCommunities();
}

export { encodeCommunityNaddr };

export default function CommunityPage() {
  const params = useParams<{ naddr: string }>();
  const naddr = params.naddr || "";
  const { pubkey, signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();

  const [community, setCommunity] = useState<CommunityData | null>(null);
  const [posts, setPosts] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postContent, setPostContent] = useState("");
  const [posting, setPosting] = useState(false);
  const [following, setFollowing] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  const decoded = useMemo(() => decodeCommunityNaddr(naddr), [naddr]);

  useEffect(() => {
    setFollowing(isFollowingCommunity(naddr));
  }, [naddr]);

  useDocumentTitle(community ? `${community.name} | Relay Outpost` : "Community | Relay Outpost");

  useEffect(() => {
    if (!decoded) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setCommunity(null);
    setPosts([]);

    const sub = pool.subscribeMany(
      COMMUNITY_RELAYS,
      { kinds: [KIND_COMMUNITY], authors: [decoded.pubkey], "#d": [decoded.identifier], limit: 1 } as any,
      {
        onevent(event: Event) {
          const parsed = parseCommunityEvent(event);
          if (parsed) {
            setCommunity(parsed);
            fetchProfilesCached([event.pubkey, ...parsed.moderators]);
            setLoading(false);
          }
        },
        oneose() {
          setLoading(false);
        },
      }
    );

    return () => { sub.close(); };
  }, [decoded?.pubkey, decoded?.identifier]);

  useEffect(() => {
    if (!community) return;

    setPostsLoading(true);
    const aTagValue = `${KIND_COMMUNITY}:${community.event.pubkey}:${community.dTag}`;
    const seenIds = new Set<string>();
    const collected: Event[] = [];

    const sub = pool.subscribeMany(
      COMMUNITY_RELAYS,
      { kinds: [1, 30023], "#a": [aTagValue], limit: 100 } as any,
      {
        onevent(event: Event) {
          if (seenIds.has(event.id)) return;
          seenIds.add(event.id);
          collected.push(event);
          fetchProfilesCached([event.pubkey]);
          const sorted = [...collected].sort((a, b) => b.created_at - a.created_at);
          setPosts(sorted);
        },
        oneose() {
          setPostsLoading(false);
        },
      }
    );

    return () => { sub.close(); };
  }, [community?.id]);

  const handlePost = async () => {
    if (!postContent.trim() || !signer || !pubkey || !community) return;

    setPosting(true);
    try {
      const aTagValue = `${KIND_COMMUNITY}:${community.event.pubkey}:${community.dTag}`;
      const eventTemplate = {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["a", aTagValue, "", "root"],
          ...clientTags(),
        ],
        content: postContent.trim(),
      };

      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const relays = community.relays.length > 0
        ? Array.from(new Set([...community.relays, ...COMMUNITY_RELAYS]))
        : COMMUNITY_RELAYS;
      await publishEvent(signedEvent, relays);
      setPostContent("");
      setPosts(prev => [signedEvent, ...prev]);
      toast({ title: "Posted", description: `Your post was published to ${community.name}.` });
    } catch (err) {
      if (isSignerError(err)) { await handleSignerError(err, toast, attemptReconnect); }
      else {
        console.error("Failed to post to community:", err);
        toast({ title: "Failed to post", description: "Could not publish your post. Make sure you're signed in.", variant: "destructive" });
      }
    } finally {
      setPosting(false);
    }
  };

  const handleToggleFollow = () => {
    const nowFollowing = toggleFollowCommunity(naddr);
    setFollowing(nowFollowing);
    toast({
      title: nowFollowing ? "Joined Community" : "Left Community",
      description: nowFollowing
        ? `${community?.name || "Community"} added to your followed communities.`
        : `${community?.name || "Community"} removed from your followed communities.`,
    });
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <div className="flex items-center justify-center py-20">
          <RelayOutpostInlineLoader className="w-6 h-6" />
          <span className="text-sm text-muted-foreground/60 ml-2">Locating community...</span>
        </div>
      </div>
    );
  }

  if (!community) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Globe className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium mb-1">Community not found</p>
          <p className="text-xs text-muted-foreground/60">This community may no longer exist or the address may be invalid.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4" data-testid="page-community">
      {community.banner && (
        <div className="rounded-xl overflow-hidden mb-4 border border-border">
          <img src={community.banner} alt={`${community.name || "Community"} banner`} className="w-full h-32 sm:h-44 object-cover" />
        </div>
      )}

      <Card className="glass-card border-border mb-4" data-testid="card-community-header">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            {community.image ? (
              <img
                src={community.image}
                alt={community.name}
                className="w-14 h-14 rounded-lg object-cover shrink-0 border border-border"
              />
            ) : (
              <div className="w-14 h-14 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <Globe className="w-7 h-7 text-brand/60 drop-shadow-[0_0_3px_rgba(168,85,247,0.4)]" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-semibold text-foreground truncate">{community.name}</h1>
                <Button
                  size="sm"
                  variant={following ? "secondary" : "outline"}
                  className="gap-1.5 text-xs ml-auto"
                  onClick={handleToggleFollow}
                  data-testid="button-follow-community"
                >
                  {following ? (
                    <><BookmarkCheck className="w-3.5 h-3.5" /> Joined</>
                  ) : (
                    <><BookmarkPlus className="w-3.5 h-3.5" /> Join</>
                  )}
                </Button>
              </div>
              {community.description && (
                <p className="text-sm text-muted-foreground mt-1">{community.description}</p>
              )}

              <div className="flex items-center gap-3 mt-3 text-[11px] text-muted-foreground/50">
                <span className="flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  {posts.length} post{posts.length !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {(() => {
                    const uniquePosters = new Set(posts.map(p => p.pubkey));
                    return `${uniquePosters.size} member${uniquePosters.size !== 1 ? "s" : ""}`;
                  })()}
                </span>
                {posts.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Activity className="w-3 h-3" />
                    Last active {(() => {
                      const latest = posts[0]?.created_at || 0;
                      const diff = Math.floor(Date.now() / 1000) - latest;
                      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
                      if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
                      return `${Math.floor(diff / 604800)}w ago`;
                    })()}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border">
            <div className="flex items-center gap-1.5 mb-2">
              <Crown className="w-3 h-3 text-amber-800/70 dark:text-amber-400/70" />
              <span className="text-[10px] text-brand/60 uppercase tracking-wider font-medium">Created by</span>
            </div>
            <ProfileLink
              pubkey={community.event.pubkey}
              className="text-sm font-medium text-brand/80"
              showAvatar={true}
              avatarSize="sm"
            />

            {community.moderators.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Shield className="w-3 h-3 text-brand/50" />
                  <span className="text-[10px] text-brand/60 uppercase tracking-wider font-medium">
                    Moderators ({community.moderators.length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {community.moderators.map(mod => (
                    <ProfileLink
                      key={mod}
                      pubkey={mod}
                      className="text-xs font-medium text-brand/70"
                      showAvatar={true}
                      avatarSize="sm"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {community.rules && (
          <button
            className="flex items-center gap-1 text-[11px] text-brand/70 hover:text-brand transition-colors"
            onClick={() => setShowRules(!showRules)}
            data-testid="button-toggle-rules"
          >
            <ScrollText className="w-3.5 h-3.5" />
            <span className="font-medium uppercase tracking-wider">Rules</span>
            {showRules ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}

        {posts.length > 0 && (
          <button
            className="flex items-center gap-1 text-[11px] text-brand/70 hover:text-brand transition-colors"
            onClick={() => setShowMembers(!showMembers)}
            data-testid="button-toggle-members"
          >
            <Users className="w-3.5 h-3.5" />
            <span className="font-medium uppercase tracking-wider">Active Members</span>
            {showMembers ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
      </div>

      {showRules && community.rules && (
        <Card className="glass-card border-border mb-4" data-testid="card-rules">
          <CardContent className="p-3">
            <p className="text-[11px] text-brand/60 uppercase tracking-wider font-medium mb-2">Community Rules</p>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{community.rules}</p>
          </CardContent>
        </Card>
      )}

      {showMembers && posts.length > 0 && (
        <Card className="glass-card border-border mb-4" data-testid="card-members">
          <CardContent className="p-3">
            <p className="text-[11px] text-brand/60 uppercase tracking-wider font-medium mb-2">
              Active Members ({new Set(posts.map(p => p.pubkey)).size})
            </p>
            <div className="flex flex-wrap gap-2">
              {Array.from(new Set(posts.map(p => p.pubkey))).slice(0, 20).map(pk => (
                <ProfileLink
                  key={pk}
                  pubkey={pk}
                  className="text-xs font-medium text-brand/70"
                  showAvatar={true}
                  avatarSize="sm"
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {pubkey && (
        <Card className="glass-card border-border mb-4" data-testid="card-compose">
          <CardContent className="p-3">
            <p className="text-[11px] text-brand/60 uppercase tracking-wider font-medium mb-2">Post to {community.name}</p>
            <Textarea
              value={postContent}
              onChange={(e) => setPostContent(e.target.value)}
              placeholder={`Share something with ${community.name}...`}
              className="bg-muted border-input text-sm min-h-[80px] resize-none mb-2 dark:bg-white/[0.03] dark:border-white/10"
              disabled={posting}
              data-testid="textarea-community-post"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handlePost}
                disabled={posting || !postContent.trim()}
                data-testid="button-publish-post"
              >
                {posting ? (
                  <RelayOutpostInlineLoader className="w-3.5 h-3.5" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Post
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!pubkey && (
        <div className="mb-4 p-3 rounded-lg bg-primary/[0.04] border border-border text-center">
          <p className="text-xs text-muted-foreground/60 italic">Sign in with Nostr to post and join this community</p>
        </div>
      )}

      <div className="space-y-3" data-testid="container-community-posts">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="w-3.5 h-3.5 text-brand/60" />
          <p className="text-[11px] text-brand/60 uppercase tracking-wider font-medium">
            Feed
          </p>
        </div>

        {postsLoading ? (
          <div className="flex items-center justify-center py-10">
            <RelayOutpostInlineLoader className="w-5 h-5" />
            <span className="text-xs text-muted-foreground/60 ml-2">Loading posts...</span>
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <FileText className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium mb-1">No posts yet</p>
            <p className="text-xs text-muted-foreground/60">
              {pubkey ? "Be the first to post in this community!" : "Sign in to be the first to post here."}
            </p>
          </div>
        ) : (
          posts.map(event => <NostrPost key={event.id} event={event} />)
        )}
      </div>
    </div>
  );
}
