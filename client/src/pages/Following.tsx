import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useLiveStatus } from "@/contexts/LiveStatusContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { use$ } from "applesauce-react/hooks";
import { eventStore, fetchProfiles, DEFAULT_RELAYS } from "@/lib/nostr";
import { prefetchProfilesBulkFromBrainstorm } from "@/lib/brainstorm-search";
import { fetchRelayLists } from "@/lib/outbox";
import { KIND_METADATA, getDisplayName, getAvatarUrl, getProfileContent, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchPill } from "@/components/SearchPill";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, MessageCircle, Users, Copy, Search, LayoutList, ArrowUpDown } from "lucide-react";
import { Nip05Badge } from "@/components/Nip05Badge";
import { BtcZapIcon } from "@/components/NostrPost";
import { ConstellationView, ConstellationIcon } from "@/components/ConstellationBubbles";
import { nip19 } from "nostr-tools";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ZapDialog } from "@/components/ZapDialog";
import { getSignalTier, getSignalTierColor, getSignalTierBg } from "@/lib/graperank";
import { copyNostrId } from "@/lib/clipboard-bridge";

type SortMode = "default" | "a-z" | "z-a" | "newest" | "oldest" | "strong" | "weak";

const ALL_SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "strong", label: "Strongest" },
  { value: "weak", label: "Weakest" },
  { value: "a-z", label: "A \u2192 Z" },
  { value: "z-a", label: "Z \u2192 A" },
  { value: "newest", label: "Newest Crew" },
  { value: "oldest", label: "Oldest Crew" },
];

const STORAGE_KEY = "people_sort_crew";

function FollowRow({ pubkey, onNavigate, isLive, connectionScores }: { pubkey: string; onNavigate: (path: string) => void; isLive: boolean; connectionScores?: Map<string, number> | null }) {
  const { toast } = useToast();
  const [showZapDialog, setShowZapDialog] = useState(false);
  const metadataEvent = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);

  const fallbackName = shortenNpub(formatNpub(pubkey));
  const displayName = metadataEvent ? (getDisplayName(metadataEvent, fallbackName) ?? fallbackName) : fallbackName;
  const avatarUrl = metadataEvent ? getAvatarUrl(metadataEvent) : undefined;
  const npub = useMemo(() => {
    try {
      return nip19.npubEncode(pubkey);
    } catch {
      return pubkey;
    }
  }, [pubkey]);
  const npubShort = shortenNpub(formatNpub(pubkey));

  const profileData = useMemo(() => {
    if (!metadataEvent) return null;
    return getProfileContent(metadataEvent);
  }, [metadataEvent]);

  const about = profileData?.about ?? null;
  const nip05 = profileData?.nip05 ?? null;
  const lud16 = profileData?.lud16 ?? null;
  const banner = profileData?.banner ?? null;

  const influence = connectionScores?.get(pubkey) ?? null;
  const scorePct = influence !== null ? Math.round(influence * 100) : null;
  const tier = influence !== null ? getSignalTier(influence) : null;

  const profileUrl = `/profile/${npub}`;

  const handleCopyNpub = (e: React.MouseEvent) => {
    e.stopPropagation();
    copyNostrId(npub);
    toast({ title: "Copied", description: "npub copied to clipboard" });
  };

  const handleCopyLud16 = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (lud16) {
      navigator.clipboard.writeText(lud16);
      toast({ title: "Copied", description: "Lightning address copied" });
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("a") || target.closest("button")) return;
    onNavigate(profileUrl);
  };

  return (
    <Card
      className={`group relative overflow-visible hover-elevate transition-all duration-150 cursor-pointer ${isLive ? "border-red-500/30 dark:border-red-500/25 shadow-[0_0_8px_1px_rgba(239,68,68,0.1)] dark:shadow-[0_0_8px_1px_rgba(239,68,68,0.15)]" : ""}`}
      onClick={handleCardClick}
      data-testid={`card-follow-${pubkey.slice(0, 8)}`}
    >
      {banner && (
        <div className="absolute inset-0 h-16 overflow-hidden rounded-t-md">
          <img src={banner} alt="" className="w-full h-full object-cover opacity-20" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-card" />
        </div>
      )}

      <div className="relative px-3 py-2.5 flex items-start gap-3">
        <Link href={profileUrl} data-testid={`link-avatar-${pubkey.slice(0, 8)}`}>
          <div className="relative shrink-0">
            <Avatar className={`w-10 h-10 shrink-0 ring-1 border border-background cursor-pointer ${isLive ? "ring-red-500/50 signal-ring-live" : "ring-primary/20"}`} data-testid={`avatar-follow-${pubkey.slice(0, 8)}`}>
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="bg-brand/10 text-brand font-bold text-xs">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {isLive && (
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0 rounded-full bg-red-500 text-white text-[7px] font-bold uppercase tracking-wider shadow-[0_0_4px_1px_rgba(239,68,68,0.4)] live-dot border border-red-400/50">
                LIVE
              </div>
            )}
          </div>
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link href={profileUrl} data-testid={`link-name-${pubkey.slice(0, 8)}`}>
              <span
                className="font-semibold text-sm cursor-pointer truncate"
                data-testid={`text-follow-name-${pubkey.slice(0, 8)}`}
              >
                {displayName}
              </span>
            </Link>
            {scorePct !== null && tier && tier !== "none" && (
              <span className={`shrink-0 inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded-full text-[11px] font-bold tabular-nums border shadow-sm dark:shadow-none ${getSignalTierBg(tier)} ${getSignalTierColor(tier)}`}>
                {scorePct}
              </span>
            )}
            {nip05 && (
              <span data-testid={`text-follow-nip05-${pubkey.slice(0, 8)}`}>
                <Nip05Badge nip05={nip05} pubkey={pubkey} className="truncate max-w-[160px]" textClassName="text-[11px] text-primary/70" iconClassName="w-3 h-3" />
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[11px] text-muted-foreground/60 font-mono truncate" data-testid={`text-follow-npub-${pubkey.slice(0, 8)}`}>
              {npubShort}
            </span>
            {lud16 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-1 py-0 text-[11px] text-amber-500/70 gap-0.5 truncate max-w-[140px]"
                onClick={handleCopyLud16}
                data-testid={`button-copy-lud16-${pubkey.slice(0, 8)}`}
              >
                <BtcZapIcon className="w-2.5 h-2.5 shrink-0" />
                <span className="truncate">{lud16}</span>
              </Button>
            )}
          </div>

          {about && (
            <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-2 leading-relaxed" data-testid={`text-follow-about-${pubkey.slice(0, 8)}`}>
              {about}
            </p>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0 pt-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground/60"
            asChild
            data-testid={`button-view-profile-${pubkey.slice(0, 8)}`}
          >
            <Link href={profileUrl}>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground/60"
            asChild
            data-testid={`button-dm-${pubkey.slice(0, 8)}`}
          >
            <Link href={`/messages?to=${npub}`}>
              <MessageCircle className="w-3.5 h-3.5" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={lud16 ? "text-amber-500/70" : "text-muted-foreground/50"}
            onClick={(e) => {
              e.stopPropagation();
              if (lud16) {
                setShowZapDialog(true);
              } else {
                toast({ title: "No lightning address", description: "This user hasn't set up a lightning address." });
              }
            }}
            data-testid={`button-zap-${pubkey.slice(0, 8)}`}
          >
            <BtcZapIcon className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground/60"
            onClick={handleCopyNpub}
            data-testid={`button-copy-npub-${pubkey.slice(0, 8)}`}
          >
            <Copy className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {showZapDialog && (
        <ZapDialog
          open={showZapDialog}
          onOpenChange={setShowZapDialog}
          pubkey={pubkey}
          recipientName={displayName}
        />
      )}
    </Card>
  );
}

export default function Following() {
  const { pubkey, follows } = useNostrAuth();
  const { livePubkeys } = useLiveStatus();
  const { scores: connectionScores, requestScoresBulk } = useGrapeRankScores();
  const [, setLocation] = useLocation();
  useDocumentTitle("Following");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "constellation">(() => {
    return (localStorage.getItem("crew_view_mode") as "list" | "constellation") || "constellation";
  });
  const hasWot = !!(connectionScores && connectionScores.size > 0);
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && ["default", "a-z", "z-a", "newest", "oldest", "strong", "weak"].includes(v)) {
        if (!hasWot && (v === "strong" || v === "weak")) return "default";
        return v as SortMode;
      }
    } catch {}
    return "default";
  });
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortOptions = useMemo(() => hasWot ? ALL_SORT_OPTIONS : ALL_SORT_OPTIONS.filter(o => o.value !== "strong" && o.value !== "weak"), [hasWot]);

  const handleSortChange = useCallback((mode: SortMode) => {
    setSortMode(mode);
    setShowSortMenu(false);
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
  }, []);

  useEffect(() => {
    if (!pubkey) {
      setLocation("/");
    }
  }, [pubkey, setLocation]);

  useEffect(() => {
    if (follows.length > 0) {
      prefetchProfilesBulkFromBrainstorm(follows.slice(0, 50));
      fetchRelayLists(follows);
      const unfetched = follows.filter(
        (pk) => !eventStore.getReplaceable(KIND_METADATA, pk)
      );
      if (unfetched.length > 0) {
        const batches: string[][] = [];
        for (let i = 0; i < unfetched.length; i += 100) {
          batches.push(unfetched.slice(i, i + 100));
        }
        batches.forEach((batch) => fetchProfiles(batch, DEFAULT_RELAYS));
      }
    }
  }, [follows]);

  useEffect(() => {
    if (follows.length > 0 && connectionScores) {
      const missing = follows.filter(pk => !connectionScores.has(pk));
      if (missing.length > 0) {
        requestScoresBulk(missing);
      }
    }
  }, [follows, connectionScores, requestScoresBulk]);

  const getNameForPubkey = useCallback((pk: string) => {
    const meta = eventStore.getReplaceable(KIND_METADATA, pk);
    if (!meta) return "";
    const content = getProfileContent(meta);
    return (content?.display_name || content?.name || "").toLowerCase();
  }, []);

  const followIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    follows.forEach((pk, i) => map.set(pk, i));
    return map;
  }, [follows]);

  const filteredFollows = useMemo(() => {
    let list: string[];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = follows.filter((pk) => {
        const meta = eventStore.getReplaceable(KIND_METADATA, pk);
        if (!meta) return pk.toLowerCase().includes(q);
        const content = getProfileContent(meta);
        const name = (content?.display_name || content?.name || "").toLowerCase();
        const nip05Val = (content?.nip05 || "").toLowerCase();
        const aboutVal = (content?.about || "").toLowerCase();
        return name.includes(q) || nip05Val.includes(q) || aboutVal.includes(q) || pk.toLowerCase().includes(q);
      });
    } else {
      list = [...follows];
    }

    if (sortMode === "strong" && connectionScores) {
      list.sort((a, b) => (connectionScores.get(b) ?? -1) - (connectionScores.get(a) ?? -1));
    } else if (sortMode === "weak" && connectionScores) {
      list.sort((a, b) => {
        const sa = connectionScores.get(a);
        const sb = connectionScores.get(b);
        if (sa === undefined && sb === undefined) return 0;
        if (sa === undefined) return 1;
        if (sb === undefined) return -1;
        return sa - sb;
      });
    } else if (sortMode === "a-z") {
      list.sort((a, b) => {
        const nameA = getNameForPubkey(a) || "zzz";
        const nameB = getNameForPubkey(b) || "zzz";
        return nameA.localeCompare(nameB);
      });
    } else if (sortMode === "z-a") {
      list.sort((a, b) => {
        const nameA = getNameForPubkey(a) || "zzz";
        const nameB = getNameForPubkey(b) || "zzz";
        return nameB.localeCompare(nameA);
      });
    } else if (sortMode === "newest") {
      list.sort((a, b) => (followIndexMap.get(b) ?? 0) - (followIndexMap.get(a) ?? 0));
    } else if (sortMode === "oldest") {
      list.sort((a, b) => (followIndexMap.get(a) ?? 0) - (followIndexMap.get(b) ?? 0));
    }

    if (livePubkeys.size > 0) {
      const live: string[] = [];
      const rest: string[] = [];
      for (const pk of list) {
        if (livePubkeys.has(pk)) live.push(pk);
        else rest.push(pk);
      }
      list = [...live, ...rest];
    }

    return list;
  }, [follows, searchQuery, sortMode, getNameForPubkey, followIndexMap, livePubkeys, connectionScores]);

  const liveCount = useMemo(() => {
    if (livePubkeys.size === 0) return 0;
    return filteredFollows.filter(pk => livePubkeys.has(pk)).length;
  }, [filteredFollows, livePubkeys]);

  if (!pubkey) return null;

  return (
    <div className="px-3 sm:px-4 py-4 sm:py-6" data-testid="page-following">
      <div className={`mx-auto ${viewMode === "constellation" ? "max-w-4xl" : "max-w-2xl"} transition-all`}>
        <div className="mb-4 sm:mb-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-lg font-semibold text-foreground" data-testid="text-following-title">Following</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                People you follow
              </p>
            </div>
            {follows.length > 0 && (
              <div className="flex items-center gap-2" data-testid="container-view-controls-following">
                <div className="relative">
                  <button
                    onClick={() => setShowSortMenu(!showSortMenu)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border transition-colors cursor-pointer ${
                      sortMode !== "default"
                        ? "border-brand/30 text-brand bg-brand/5"
                        : "border-border/40 dark:border-border/20 text-muted-foreground hover:text-foreground bg-muted/20 dark:bg-muted/10"
                    }`}
                    data-testid="button-sort-following"
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{sortOptions.find(o => o.value === sortMode)?.label || "Sort"}</span>
                  </button>
                  {showSortMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md border border-border/40 dark:border-border/20 bg-card shadow-lg py-1" data-testid="menu-sort-following">
                        {sortOptions.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => handleSortChange(opt.value)}
                            className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                              sortMode === opt.value
                                ? "text-brand bg-brand/5 font-medium"
                                : "text-foreground hover:bg-muted/30"
                            }`}
                            data-testid={`sort-option-${opt.value}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-border/40 p-0.5 bg-muted/30" data-testid="container-view-toggle-following">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 ${viewMode === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground/60"}`}
                    onClick={() => { setViewMode("list"); localStorage.setItem("crew_view_mode", "list"); }}
                    title="List view"
                    data-testid="button-view-list-following"
                  >
                    <LayoutList className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 ${viewMode === "constellation" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground/60"}`}
                    onClick={() => { setViewMode("constellation"); localStorage.setItem("crew_view_mode", "constellation"); }}
                    title="Constellation view"
                    data-testid="button-view-constellation-following"
                  >
                    <ConstellationIcon className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {follows.length > 1 && (
            <div className="flex items-center gap-1 mt-3 flex-wrap">
              <button
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-colors border cursor-pointer ${
                  sortMode === "default"
                    ? "border-brand/30 bg-brand/10 text-brand"
                    : "border-transparent text-foreground/40 dark:text-foreground/30 hover:text-foreground/60"
                }`}
                onClick={() => handleSortChange("default")}
              >
                All
              </button>
              <button
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-colors border cursor-pointer ${
                  sortMode === "a-z"
                    ? "border-brand/30 bg-brand/10 text-brand"
                    : "border-transparent text-foreground/40 dark:text-foreground/30 hover:text-foreground/60"
                }`}
                onClick={() => handleSortChange(sortMode === "a-z" ? "default" : "a-z")}
              >
                A → Z
              </button>
              <button
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-colors border cursor-pointer ${
                  sortMode === "z-a"
                    ? "border-brand/30 bg-brand/10 text-brand"
                    : "border-transparent text-foreground/40 dark:text-foreground/30 hover:text-foreground/60"
                }`}
                onClick={() => handleSortChange(sortMode === "z-a" ? "default" : "z-a")}
              >
                Z → A
              </button>
            </div>
          )}

          {follows.length > 5 && (
            <SearchPill
              containerClassName="mt-3"
              placeholder="Search by name, NIP-05, or about..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search-following"
            />
          )}
        </div>

        {follows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="container-empty-following-page">
            <Users className="w-12 h-12 text-muted-foreground/60 mb-3" />
            <p className="text-sm font-medium mb-1">Not following anyone yet</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Explore the Global feed to discover people in the Nostr network.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              asChild
              data-testid="button-browse-global"
            >
              <Link href="/">Browse Global Feed</Link>
            </Button>
          </div>
        ) : filteredFollows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="container-no-results">
            <Search className="w-8 h-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No matches found</p>
          </div>
        ) : viewMode === "constellation" ? (
          <ConstellationView pubkeys={filteredFollows} connectionScores={connectionScores} />
        ) : (
          <>
            {liveCount > 0 && liveCount < filteredFollows.length && (
              <>
                <div className="flex flex-col gap-1.5" data-testid="container-follow-list-live">
                  {filteredFollows.slice(0, liveCount).map((pk) => (
                    <FollowRow key={pk} pubkey={pk} onNavigate={setLocation} isLive={true} connectionScores={connectionScores} />
                  ))}
                </div>
                <div className="relative py-5">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full h-[2px] bg-gradient-to-r from-transparent via-brand/50 dark:via-brand/40 to-transparent" />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5" data-testid="container-follow-list">
                  {filteredFollows.slice(liveCount).map((pk) => (
                    <FollowRow key={pk} pubkey={pk} onNavigate={setLocation} isLive={false} connectionScores={connectionScores} />
                  ))}
                </div>
              </>
            )}
            {(liveCount === 0 || liveCount === filteredFollows.length) && (
              <div className="flex flex-col gap-1.5" data-testid="container-follow-list">
                {filteredFollows.map((pk) => (
                  <FollowRow key={pk} pubkey={pk} onNavigate={setLocation} isLive={livePubkeys.has(pk)} connectionScores={connectionScores} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
