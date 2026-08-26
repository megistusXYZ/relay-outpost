import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useNostrFeeds } from "@/hooks/use-nostr-feeds";
import { useToast } from "@/hooks/use-toast";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { getProfileContent, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { fetchDiscoveryPacks, type FollowPackInfo } from "@/lib/follow-packs";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import {
  Package, Users, ChevronDown, Headphones, Radio } from "lucide-react";

function PackCard({
  pack,
  onTuneIn,
  tuningPackId }: {
  pack: FollowPackInfo;
  onTuneIn: (pack: FollowPackInfo) => Promise<void>;
  tuningPackId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesReady, setProfilesReady] = useState(false);
  const previewCount = 5;
  const previewMembers = pack.members.slice(0, previewCount);
  const isTuning = tuningPackId === pack.id;

  useEffect(() => {
    if (expanded && !profilesReady) {
      setProfilesLoading(true);
      const allPks = [pack.pubkey, ...pack.members];
      fetchProfilesCached(allPks);
      const timer = setTimeout(() => {
        setProfilesLoading(false);
        setProfilesReady(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [expanded, profilesReady, pack.pubkey, pack.members]);

  const creatorProfile = eventStore.getByFilters({ kinds: [0], authors: [pack.pubkey] });
  const creatorEvent = creatorProfile.length > 0 ? creatorProfile[0] : null;
  const creatorContent = creatorEvent ? getProfileContent(creatorEvent) : null;
  const creatorNpub = formatNpub(pack.pubkey);

  return (
    <div
      className="rounded-xl overflow-hidden transition-all duration-200 border border-brand/10 bg-white/[0.02] dark:bg-white/[0.02]"
      data-testid={`card-browse-pack-${pack.id.slice(0, 8)}`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}
        className="w-full text-left p-3 cursor-pointer hover:bg-muted/20 transition-colors"
        data-testid={`button-expand-browse-pack-${pack.id.slice(0, 8)}`}
      >
        <div className="flex items-start gap-2.5 min-w-0">
          {/* Per-pack box glyph removed — it duplicated the dialog header's
              Package icon on every row for no added meaning. */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-1.5 mb-0.5 min-w-0">
              <h3 className="text-sm font-semibold truncate min-w-0 flex-1">{pack.title}</h3>
              <Badge variant="outline" className="text-[9px] border-brand/20 text-brand/70 shrink-0 whitespace-nowrap px-1.5 py-0">
                {pack.members.length}
              </Badge>
            </div>

            {pack.description && (
              <p className="text-xs text-muted-foreground/60 line-clamp-1 mb-1.5" style={{ overflowWrap: "anywhere" }}>{pack.description}</p>
            )}

            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <div className="flex items-center -space-x-2 shrink-0">
                  {previewMembers.map((pk, i) => {
                    const mEvents = eventStore.getByFilters({ kinds: [0], authors: [pk] });
                    const mContent = mEvents.length > 0 ? getProfileContent(mEvents[0]) : null;
                    return (
                      <Avatar key={pk} className="w-5 h-5 border-2 border-background" style={{ zIndex: previewCount - i }}>
                        <AvatarImage src={mContent?.picture} alt={mContent?.display_name || mContent?.name || ""} />
                        <AvatarFallback className="text-[7px] bg-muted text-muted-foreground">
                          {(mContent?.display_name || mContent?.name || "?").slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    );
                  })}
                  {pack.members.length > previewCount && (
                    <div className="w-5 h-5 rounded-full border-2 border-background bg-muted flex items-center justify-center" style={{ zIndex: 0 }}>
                      <span className="text-[7px] font-mono text-muted-foreground">+{pack.members.length - previewCount}</span>
                    </div>
                  )}
                </div>

                {creatorContent && (
                  <span className="text-[10px] text-muted-foreground/40 truncate min-w-0">
                    by {creatorContent.display_name || creatorContent.name || shortenNpub(creatorNpub)}
                  </span>
                )}
              </div>

              <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/30 transition-transform duration-200 shrink-0 ${expanded ? "rotate-180" : ""}`} />
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/30 px-3 py-3 space-y-2 overflow-hidden" data-testid={`container-browse-pack-members-${pack.id.slice(0, 8)}`}>
          {pack.description && (
            <p className="text-xs text-muted-foreground/60 leading-relaxed mb-3" style={{ overflowWrap: "anywhere" }}>{pack.description}</p>
          )}

          <div className="flex items-center flex-wrap gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Users className="w-3 h-3 text-brand/50 shrink-0" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/40 truncate">
                {pack.members.length} members
              </span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onTuneIn(pack); }}
              disabled={isTuning || tuningPackId !== null}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border border-brand/30 text-brand hover:bg-brand/10 hover:border-brand/50 transition-all duration-200 disabled:opacity-50 cursor-pointer"
              data-testid={`button-tunein-browse-pack-${pack.id.slice(0, 8)}`}
            >
              {isTuning ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <Headphones className="w-3 h-3" />}
              Tune In
            </button>
          </div>

          {profilesLoading ? (
            <div className="flex items-center gap-2 py-4 justify-center">
              <RelayOutpostInlineLoader />
              <span className="text-[10px] text-muted-foreground/40 font-mono tracking-wider">LOADING PROFILES...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-1">
              {Array.from(new Set(pack.members)).map(pk => {
                const mEvents = eventStore.getByFilters({ kinds: [0], authors: [pk] });
                const mContent = mEvents.length > 0 ? getProfileContent(mEvents[0]) : null;
                const npub = formatNpub(pk);
                return (
                  <Link key={pk} href={`/profile/${npub}`} className="block overflow-hidden">
                    <div className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-muted/30 transition-colors cursor-pointer min-w-0" data-testid={`card-browse-pack-member-${pk.slice(0, 8)}`}>
                      <Avatar className="w-7 h-7 border border-border shrink-0">
                        <AvatarImage src={mContent?.picture} alt={mContent?.display_name || mContent?.name || ""} />
                        <AvatarFallback className="text-[9px] bg-muted text-muted-foreground">
                          {(mContent?.display_name || mContent?.name || "?").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{mContent?.display_name || mContent?.name || shortenNpub(npub)}</p>
                        <p className="text-[10px] text-muted-foreground/50 truncate">{shortenNpub(npub)}</p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          <div className="pt-2 border-t border-border/20 overflow-hidden">
            <Link href={`/profile/${creatorNpub}`} className="block min-w-0">
              <span className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer truncate block">
                Created by {creatorContent?.display_name || creatorContent?.name || shortenNpub(creatorNpub)}
              </span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function BrowsePacksDialog({
  open,
  onOpenChange,
  onFeedCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFeedCreated: (feedId: string) => void;
}) {
  const [packs, setPacks] = useState<FollowPackInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [tuningPackId, setTuningPackId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const { pubkey, signer } = useNostrAuth();
  const { createFeed } = useNostrFeeds();
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchDiscoveryPacks()
      .then(result => setPacks(result))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const handleTuneIn = async (pack: FollowPackInfo) => {
    if (!pubkey || !signer) {
      toast({ title: "Sign in required", description: "Log in to tune into this pack.", variant: "destructive" });
      return;
    }
    setTuningPackId(pack.id);
    try {
      const allAuthors = Array.from(new Set([pack.pubkey, ...pack.members]));
      const feed = await createFeed({
        name: pack.title,
        hashtags: [],
        authorPubkeys: allAuthors,
        includeKeywords: [],
        excludeKeywords: [],
        contentType: "all",
        source: "pack" });
      if (feed) {
        toast({ title: "Feed Tuned", description: `"${pack.title}" is now in your feeds.` });
        onOpenChange(false);
        onFeedCreated(feed.id);
      }
    } catch {
      toast({ title: "Error", description: "Failed to create feed.", variant: "destructive" });
    } finally {
      setTuningPackId(null);
    }
  };

  const content = (
    <div className="space-y-3">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <RelayOutpostInlineLoader />
          <span className="text-[10px] text-muted-foreground/40 font-mono uppercase tracking-wider">Scanning for packs...</span>
        </div>
      ) : packs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center mb-3">
            <Radio className="w-6 h-6 text-brand/70" />
          </div>
          <p className="text-sm font-medium mb-1">No packs found</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Couldn't find any starter packs right now. Try again later.
          </p>
        </div>
      ) : (
        packs.map(pack => (
          <PackCard
            key={pack.id}
            pack={pack}
            onTuneIn={handleTuneIn}
            tuningPackId={tuningPackId}
          />
        ))
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="border-brand/20 bg-background dark:bg-[hsl(260,8%,4%)] overflow-hidden">
          <DrawerHeader className="pb-2">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-md bg-brand/10">
                <Package className="w-4 h-4 text-brand" />
              </div>
              <div>
                <DrawerTitle className="text-sm font-semibold text-foreground">Browse Packs</DrawerTitle>
                <p className="text-[11px] text-brand/40 mt-0.5">Discover curated starter packs</p>
              </div>
            </div>
          </DrawerHeader>
          <div className="px-3 pb-4 overflow-y-auto overflow-x-hidden max-h-[70vh]">
            {content}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto overflow-x-hidden border-brand/20 bg-background dark:bg-[hsl(260,8%,4%)]">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-brand/10">
              <Package className="w-4 h-4 text-brand" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold">Browse Packs</DialogTitle>
              <DialogDescription className="text-[11px] text-brand/40 mt-0.5">
                Discover curated starter packs
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="py-1 overflow-hidden">
          {content}
        </div>
      </DialogContent>
    </Dialog>
  );
}
