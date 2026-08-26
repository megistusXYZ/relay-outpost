import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from "react";
import { useIaCollapsed } from "@/lib/ia-prefs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchPill } from "@/components/SearchPill";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Nip05Badge } from "@/components/Nip05Badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RelayOutpostLoader, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { MessagesIcon } from "@/components/icons/MessagesIcon";
import { ConcordPendingInvites } from "@/components/concord/ConcordPendingInvites";
import {
  ArrowLeft,
  Archive,
  BookUser,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Pin as PinOff,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Undo2,
  Users, } from "lucide-react";
import { nip19 } from "nostr-tools";
import type { ISigner } from "applesauce-signers";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useLocation } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { indicatorHeight, pullArmed } from "@/lib/pull-to-refresh";
import { ChatListRow } from "./ChatListRow";
import { IaMovedNotice } from "@/components/IaMovedNotice";
import { buildCreateActions } from "./create-actions";
import { getDMDisplayName, formatMessageTime, needsSynthesizedPeopleSection, sectionChatEntries, communitiesForTab, chatFilterOptions, applyChatFilter, resolveChatFilter, type ChatFilter, type ChatEntry, type ConversationPreview, type DmTab, type OutpostPreview, type ProfileInfo } from "./helpers";
import { refreshOutcome, type RefreshOutcome } from "./refresh-outcome";
import { canReachAny } from "@/lib/relay-reach";
import { getMyDMReceiveRelays } from "@/lib/outbox";
import { getOutpostRelays, getOutpostMeta, saveOutpostMeta, type OutpostRelay } from "@/lib/outpost-relays";
import { getPinnedFeeds, groupPinsByRelay, pinUrl, normalizeUrl, type PinnedFeed } from "@/lib/pinned-feeds";
import { unpinRoomEverywhere } from "@/lib/room-pins";
import { usePrivateMasked, togglePrivateMasked, revealPrivateMasked, ensurePrivateModeRearm } from "@/lib/private-mode";
import { displayNameWith, getPetname, matchesQueryWith, usePetnamesVersion, isShowingRealNames, toggleShowRealNames, hasAnyPetnames, type PetnameKind } from "@/lib/petnames";
import { petnameImageUrlSync } from "@/lib/petname-images";
import { PetnameDialog } from "@/components/PetnameDialog";
import { fetchCommunityActivity, fetchRoomActivity } from "@/lib/community-activity";
import { fetchSimpleGroupsList, type SimpleGroupEntry } from "@/lib/nip29";
import { buildRoomRows } from "@/lib/room-entries";
import { readChannelLastRead } from "@/lib/room-read";
import { TAB_ICON, TAB_LABEL, pinDisplayLabel } from "@/lib/pin-meta";
import { relayDisplayName } from "@/lib/outpost-directory";
import { fetchNip11, type Nip11Document } from "@/lib/nip11";

/** Same placeholder the Outposts cards use, so one community looks identical in
 *  both lists. */

/**
 * A pinned ROOM, as opposed to a pin of the whole Chat tab.
 *
 * `tab === "channels"` alone is not enough: pinning a community's Chat TAB
 * stores the same tab with no `channelId`, and that pin's destination is the
 * room list — which is exactly where the parent row already goes. Rendering it
 * would put a second row under the first that opens the same screen.
 */
const isRoomPin = (p: PinnedFeed) => p.tab === "channels" && !!p.channelId;

/**
 * "Some people you don't know are trying to reach you."
 *
 * This replaces the Requests TAB. A tab implied requests were a peer view of
 * your inbox — half the header, permanently, for a folder most people open
 * rarely — and it hid Groups and Communities whenever you were in it.
 *
 * Styled unlike a conversation row on purpose. A row that looked like a chat
 * would put a stranger a mis-tap away from reading as a friend, and the whole
 * reason this set is separated is that its senders are unvouched.
 */
function RequestsRow({ total, unread, onOpen }: { total: number; unread: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-3 px-3 min-h-[56px] text-left transition-colors hover:bg-primary/[0.04] active:bg-primary/[0.06]"
      data-testid="row-message-requests"
    >
      <span className="w-10 h-10 shrink-0 rounded-full bg-muted/60 border border-border/50 flex items-center justify-center">
        <Users className="w-4 h-4 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">
          {total === 1 ? "1 request" : `${total} requests`}
        </span>
        <span className="block text-xs text-muted-foreground truncate">
          From people not yet in your network
        </span>
      </span>
      {unread > 0 && (
        <span className="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-brand text-white text-[11px] font-semibold" data-testid="requests-unread-count">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground/40" />
    </button>
  );
}

export interface DmUserSearchResult {
  pubkey: string;
  name: string;
  displayName?: string;
  picture?: string;
  nip05?: string;
}

interface ChatListProps {
  pubkey: string;
  signer: ISigner | null;
  conversations: ConversationPreview[];
  /** Merged DM + group entries for the active tab, recency-sorted desc. */
  entries: ChatEntry[];
  /** How many group chats exist (search-box gate counts them alongside DMs). */
  groupCount: number;
  /** True while a thread covers the list (the parent display:none's us) — the
   *  cue to put the reader's scroll position back when they return. */
  hidden?: boolean;
  /** Refresh group chats (invite accepted from the pending-invites card). */
  onReloadGroups: () => void;
  /** Concord enabled + signed-in — gates the "New group chat" menu item. */
  canCreateGroup: boolean;
  onNewGroupChat: () => void;
  /** Channel id rides along while the group is unread (first-unread deep-link). */
  onOpenGroup: (communityId: string, channelId?: string) => void;
  profiles: Map<string, ProfileInfo>;
  /** Privacy: swap every row's message preview for a generic line. */
  hidePreviews: boolean;
  selectedPubkey: string | null;
  dmTab: DmTab;
  setDmTab: (tab: DmTab) => void;
  requestUnreadCount: number;
  totalRequestCount: number;
  loading: boolean;
  loadingTooLong: boolean;
  loadConversations: (forceDecrypt?: boolean) => Promise<void>;
  searchFilter: string;
  setSearchFilter: (value: string) => void;
  showNewChat: boolean;
  setShowNewChat: (value: boolean) => void;
  /** QR-scan + join-via-link sheets are owned by Messages so the empty-state
      actions and the "+" menu drive the same single render (no double-mount). */
  showQrScan: boolean;
  setShowQrScan: (value: boolean) => void;
  showJoinLink: boolean;
  setShowJoinLink: (value: boolean) => void;
  newChatInput: string;
  setNewChatInput: (value: string) => void;
  handleNewChat: () => void;
  userSearchResults: DmUserSearchResult[];
  setUserSearchResults: (results: DmUserSearchResult[]) => void;
  userSearching: boolean;
  handleSelectSearchResult: (pubkey: string) => void;
  pendingDecryptCount: number;
  decrypting: boolean;
  decryptPending: () => void;
  showDeleted: boolean;
  setShowDeleted: (value: boolean) => void;
  hiddenConvos: Set<string>;
  hiddenMsgIds: Set<string>;
  onPreviewDeletedConversation: (pubkey: string) => void;
  handleRestoreConversation: (pubkey: string) => void;
  onRestoreAllHiddenMessages: () => void;
  handleClearAllHidden: () => void;
  navigateToConversation: (pubkey: string) => void;
  onOpenProfile: (pubkey: string) => void;
  handlePromoteToPrimary: (pubkey: string) => void;
  handleDemoteToRequests: (pubkey: string) => void;
  onRemoveConversation: (pubkey: string) => void;
}

/**
 * The conversation list pane: 1:1 DMs and Concord group chats merged into one
 * recency-sorted list (groups join the Primary tab only). Owns no state:
 * everything it reads — including the new-chat / QR-scan / join-via-link sheet
 * toggles — arrives via props from Messages.tsx.
 */
export function ChatList({
  pubkey,
  signer,
  conversations,
  entries,
  groupCount,
  hidden,
  onReloadGroups,
  canCreateGroup,
  onNewGroupChat,
  onOpenGroup,
  profiles,
  hidePreviews,
  selectedPubkey,
  dmTab,
  setDmTab,
  requestUnreadCount,
  totalRequestCount,
  loading,
  loadingTooLong,
  loadConversations,
  searchFilter,
  setSearchFilter,
  showNewChat,
  setShowNewChat,
  showQrScan,
  setShowQrScan,
  showJoinLink,
  setShowJoinLink,
  newChatInput,
  setNewChatInput,
  handleNewChat,
  userSearchResults,
  setUserSearchResults,
  userSearching,
  handleSelectSearchResult,
  pendingDecryptCount,
  decrypting,
  decryptPending,
  showDeleted,
  setShowDeleted,
  hiddenConvos,
  hiddenMsgIds,
  onPreviewDeletedConversation,
  handleRestoreConversation,
  onRestoreAllHiddenMessages,
  handleClearAllHidden,
  navigateToConversation,
  onOpenProfile,
  handlePromoteToPrimary,
  handleDemoteToRequests,
  onRemoveConversation,
}: ChatListProps) {
  // Remembering where you were is most of what "getting back to your chats"
  // means. The wrapper around this list is display:none'd while a thread is
  // open (Messages.tsx), which zeroes the scroll box — so without this the list
  // snapped to the top every time you backed out of a conversation.
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  // Search-focus expansion (owner call, 2026-08-18): while the search is in
  // use its pill owns the whole row — the trailing controls collapse away and
  // a Cancel appears (the iOS search-bar idiom). "In use" is focused OR
  // non-empty: focus alone must not be the gate, or tapping a filtered result
  // (which blurs the input) would snap the row shut under the finger.
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchExpanded = searchFocused || searchFilter.length > 0;
  const listScrollTop = useRef(0);
  const rememberListScroll = useCallback(() => {
    if (listScrollRef.current) listScrollTop.current = listScrollRef.current.scrollTop;
  }, []);
  // The element keeps its identity across the hide (it is only display:none'd),
  // so the offset can be written straight back once it has a box again.
  useEffect(() => {
    const el = listScrollRef.current;
    if (!el || hidden || !listScrollTop.current) return;
    if (el.scrollTop !== listScrollTop.current) el.scrollTop = listScrollTop.current;
  }, [hidden, entries.length]);
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();
  const iaCollapsed = useIaCollapsed();
  // The communities you've joined, read straight from the same store the
  // Outposts page and the desktop rail's flyout use — so the order here is the
  // order you set by dragging there, and joining or leaving updates all three
  // without a reload. Same event contract SidebarOutposts listens on.
  // A community's icon and display name live in its NIP-11 document, not in the
  // joined record — so read the cached copy synchronously (real avatars on the
  // first frame) and refresh from the relay behind it.
  const toPreview = (r: OutpostRelay): OutpostPreview => {
    const meta = getOutpostMeta(r.url);
    return {
      url: r.url,
      label: relayDisplayName(r.url, meta.name ? ({ name: meta.name } as Nip11Document) : null, r.label),
      icon: meta.icon,
      private: r.access === "private",
    };
  };
  const [joinedCommunities, setJoinedCommunities] = useState<OutpostPreview[]>(() =>
    getOutpostRelays().map(toPreview),
  );
  /**
   * Rooms the user pinned, so Chats stops being the one place they don't appear.
   *
   * The pin button writes TWO stores (CommsTab handleTogglePin): a per-relay
   * localStorage list that floats the room up its own community's room list, and
   * this shared one, which the Outposts hub and the sidebar both read to nest the
   * room under its community. Chats read neither, so a room pinned specifically
   * to be reached fast was reachable everywhere except the list of chats.
   *
   * A pin is NOT promoted to a ChatEntry, and that is the whole design. Every
   * member of that union carries a clock; a PinnedFeed carries none, so it could
   * only enter the recency sort by inventing one — the same reason joined
   * outposts are passed to sectionChatEntries separately. `isCommunityEntry`'s
   * note anticipates NIP-29 rooms landing in Communities "when they become chat
   * entries", i.e. when they bring a real address AND real activity. Filling that
   * slot now with a permanently clockless stand-in would occupy the space the
   * real thing is meant to take.
   *
   * `channelId` is what separates a pinned ROOM from a pin of the whole Chat tab
   * — the same predicate Outposts uses to build quickAccessChannelIds. Pins of
   * Posts / Discussions / Articles are views, not chats, and stay on the hub.
   */
  const [roomPins, setRoomPins] = useState<PinnedFeed[]>(() => getPinnedFeeds().filter(isRoomPin));
  useEffect(() => {
    const sync = () => {
      setJoinedCommunities(getOutpostRelays().map(toPreview));
      setRoomPins(getPinnedFeeds().filter(isRoomPin));
    };
    window.addEventListener("outpost-relays-changed", sync);
    // Dispatched by savePinnedFeeds, so pinning in a room updates this list in
    // the same tick it updates the sidebar. Same three-listener contract
    // SidebarOutposts uses — this is the third consumer, not a new dialect.
    window.addEventListener("pinned-feeds-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("outpost-relays-changed", sync);
      window.removeEventListener("pinned-feeds-changed", sync);
      window.removeEventListener("storage", sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // NOT cleanupPinnedFeeds(). It WRITES — a filtered store saved over the base —
  // and getOutpostRelays() can be briefly empty during hydration, so a display
  // surface calling it could persist the empty read as a deletion. Declining to
  // RENDER an orphan is not the same act as PRUNING one, and only one of them is
  // destructive. The hub already prunes, on a surface that owns the data.
  const roomsByRelay = useMemo(() => groupPinsByRelay(roomPins), [roomPins]);

  /**
   * The rooms this member is actually IN — their kind-10009, read with the
   * display-safe fetch. NEVER republished from here: fetchSimpleGroupsList
   * resolves [] for an unreachable relay set, and building a replaceable event
   * on that wipes the list (loadSimpleGroupsBase + its blocked flag exist for
   * the write path; this surface only renders).
   *
   * This is the Stage-3 "rooms as first-class entries" item: pinned rooms have
   * rendered under their community since Stage 2.8, but a room you JOINED and
   * never pinned was invisible here — reachable only by opening the community
   * and its Chat tab, which is exactly the burial the Chats list exists to end.
   */
  const [joinedRooms, setJoinedRooms] = useState<SimpleGroupEntry[]>([]);
  useEffect(() => {
    if (!iaCollapsed || !pubkey) return;
    let cancelled = false;
    fetchSimpleGroupsList(pubkey).then((entries) => {
      if (!cancelled) setJoinedRooms(entries);
    });
    return () => { cancelled = true; };
  }, [iaCollapsed, pubkey]);
  const joinedRoomsByRelay = useMemo(() => {
    const m = new Map<string, SimpleGroupEntry[]>();
    for (const e of joinedRooms) {
      const k = normalizeUrl(e.relayUrl);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [joinedRooms]);

  /**
   * A parent row for rooms whose relay is NOT in Your Outposts.
   *
   * Real case, not an edge: joining a room never used to add its relay to the
   * outposts list (joinOutpost has exactly one caller — an explicit button), so
   * a member who followed a room link and knocked is in the room while the
   * relay is nowhere in their communities. The join path now heals this going
   * forward (CommsTab calls joinOutpostWithEnrichment on add), but memberships
   * that predate that fix still need a parent to render under.
   *
   * DISPLAY-ONLY synthesis, deliberately not a durable self-heal: writing the
   * relay into the outposts store from a render surface would re-add a
   * community the user explicitly left while keeping the room — a fight the
   * user always loses. Rendering claims only what is true: you are in this
   * room, on this relay.
   */
  const [orphanParents, setOrphanParents] = useState<OutpostPreview[]>([]);
  const joinedCommunitiesKey = joinedCommunities.map((c) => c.url).join(",");
  useEffect(() => {
    const have = new Set(joinedCommunitiesKey ? joinedCommunitiesKey.split(",").map((u) => normalizeUrl(u)) : []);
    const orphans = [...joinedRoomsByRelay.values()]
      .map((rooms) => rooms[0].relayUrl)
      .filter((url) => !have.has(normalizeUrl(url)));
    if (orphans.length === 0) {
      // Keep the same [] reference when already empty — a fresh array here
      // would re-render the whole list every time the deps tick over.
      setOrphanParents((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const hostOf = (url: string) => {
      try { return new URL(url).hostname || url; } catch { return url.replace(/^wss?:\/\//i, ""); }
    };
    // Paint from the meta cache immediately; enrich from NIP-11 in the
    // background (fetchNip11 is cached, so revisits cost nothing).
    setOrphanParents(orphans.map((url) => {
      const meta = getOutpostMeta(url);
      return { url, label: meta.name || hostOf(url), icon: meta.icon };
    }));
    let cancelled = false;
    Promise.all(orphans.map(async (url) => {
      const doc = await fetchNip11(url).catch(() => null);
      if (doc) saveOutpostMeta(url, { icon: doc.icon, name: doc.name });
      return { url, doc };
    })).then((results) => {
      if (cancelled) return;
      setOrphanParents((prev) => prev.map((o) => {
        const hit = results.find((r) => r.url === o.url && r.doc);
        return hit?.doc
          ? { ...o, icon: hit.doc.icon || o.icon, label: relayDisplayName(o.url, hit.doc, o.label) }
          : o;
      }));
    });
    return () => { cancelled = true; };
  }, [joinedRoomsByRelay, joinedCommunitiesKey]);

  /**
   * Newest activity per ROOM (pinned + joined), per relay — the honest clock
   * behind the timestamps and unread dots on the nested rows.
   *
   * `null` for a relay means we never reached it (or it refused us), and
   * buildRoomRows renders those rows silent: no timestamp, no dot. This is the
   * distinction the Stage-2.8 comment refused to fake with a naive
   * fetchLastActivityBatch call — the batch resolves on oneose, and a relay
   * that FAILS to connect fires oneose in ~150ms with zero events. Gating on
   * the connection (withReach inside fetchRoomActivity) is what makes the
   * timestamp a claim we can stand behind.
   */
  const [roomActivity, setRoomActivity] = useState<Map<string, Record<string, number> | null>>(new Map());
  const roomTargets = useMemo(() => {
    const byRelay = new Map<string, { key: string; url: string; ids: Set<string> }>();
    const add = (relayUrl: string, id: string | undefined) => {
      if (!id) return;
      const k = normalizeUrl(relayUrl);
      if (!byRelay.has(k)) byRelay.set(k, { key: k, url: relayUrl, ids: new Set() });
      byRelay.get(k)!.ids.add(id);
    };
    for (const p of roomPins) add(p.relayUrl, p.channelId);
    for (const e of joinedRooms) add(e.relayUrl, e.groupId);
    return [...byRelay.values()]
      .map(({ key, url, ids }) => ({ key, url, ids: [...ids].sort() }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [roomPins, joinedRooms]);
  // JSON, not hand-rolled separators: relay urls and group ids are external
  // strings, and a "+" or ";" inside one would silently corrupt a split.
  const roomTargetsKey = JSON.stringify(roomTargets);
  useEffect(() => {
    if (!iaCollapsed || roomTargets.length === 0) return;
    let cancelled = false;
    Promise.all(roomTargets.map(async ({ key, url, ids }) => {
      const map = await fetchRoomActivity(url, ids).catch(() => null);
      return [key, map] as const;
    })).then((entries) => {
      if (!cancelled) setRoomActivity(new Map(entries));
    });
    return () => { cancelled = true; };
    // roomTargets is exactly what roomTargetsKey serializes: when the key
    // changes, this closure was created in the same render as the new value,
    // so it is never stale. (No ESLint here — see no-eslint-stale-hook-deps.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iaCollapsed, roomTargetsKey]);

  /**
   * Newest activity per joined community, so a busy one rises.
   *
   * Only relays that ANSWERED land in this map — see community-activity.ts. An
   * absent entry means "we did not get to ask", and the ordering treats that as
   * a reason to leave the row exactly where the user dragged it rather than to
   * rank it as dead.
   *
   * Fired once per set of joined communities, not on every render, and never
   * awaited by anything the list needs to paint: the sections render
   * immediately in saved order and re-sort when answers arrive.
   */
  const [communityActivity, setCommunityActivity] = useState<Map<string, number>>(new Map());
  const communityUrlKey = joinedCommunities.map((c) => c.url).join(",");
  useEffect(() => {
    if (!iaCollapsed) return; // communities only render in the sectioned list
    const urls = communityUrlKey ? communityUrlKey.split(",") : [];
    if (urls.length === 0) return;
    let cancelled = false;
    fetchCommunityActivity(urls).then((map) => {
      if (!cancelled) setCommunityActivity(map);
    });
    return () => { cancelled = true; };
  }, [communityUrlKey, iaCollapsed]);
  // Refresh each community's look from its relay. fetchNip11 is cached 5m in
  // memory, so revisiting Chats costs nothing; a cold load costs one small HTTP
  // request per community, resolved in parallel and written through to the
  // cache so the NEXT cold load paints instantly.
  const communityUrls = joinedCommunities.map((c) => c.url).join(",");
  useEffect(() => {
    if (!communityUrls) return;
    let cancelled = false;
    const urls = communityUrls.split(",");
    Promise.all(
      urls.map(async (url) => {
        const doc = await fetchNip11(url).catch(() => null);
        if (!doc) return null;
        saveOutpostMeta(url, { icon: doc.icon, name: doc.name });
        return { url, doc };
      }),
    ).then((results) => {
      if (cancelled) return;
      const resolved = new Map(
        results.filter((r): r is { url: string; doc: Nip11Document } => !!r).map((r) => [r.url, r.doc]),
      );
      if (!resolved.size) return;
      setJoinedCommunities((prev) =>
        prev.map((c) => {
          const doc = resolved.get(c.url);
          if (!doc) return c;
          // Keep the cached icon if this response has none — a relay that
          // stops advertising one shouldn't blank an avatar we already show.
          return { ...c, icon: doc.icon || c.icon, label: relayDisplayName(c.url, doc, c.label) };
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [communityUrls]);
  // ── Petnames (lib/petnames.ts): YOUR names win in lists; real names stay on
  // the profile and in the rename dialog. The version ticks on any change so
  // rows re-read without per-subject subscriptions. Declared ABOVE the memos
  // that list it as a dependency.
  const petnamesVersion = usePetnamesVersion();
  const [petnameTarget, setPetnameTarget] = useState<{ kind: PetnameKind; id: string; realName: string } | null>(null);

  // Joined outposts plus the synthesized parents for orphan rooms. Dedup on the
  // normalized url with the REAL outpost winning — during the tick where a
  // relay graduates from orphan to joined, both lists briefly hold it.
  const allCommunities = useMemo(() => {
    if (orphanParents.length === 0) return joinedCommunities;
    const have = new Set(joinedCommunities.map((c) => normalizeUrl(c.url)));
    return [...joinedCommunities, ...orphanParents.filter((o) => !have.has(normalizeUrl(o.url)))];
  }, [joinedCommunities, orphanParents]);
  // `entries` arrives already filtered by the search box; joined communities are
  // ours to filter, or typing a name would leave every community on screen and
  // make the search look broken.
  const visibleCommunities = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return allCommunities;
    // A community also stays when one of ITS rooms matches — pinned or joined.
    // Without this the search actively hides what you searched for: typing a
    // room's name drops its community — the row that carries it — so the one
    // thing you asked for is the one thing that disappears.
    const relaysWithMatchingRoom = new Set([
      ...roomPins
        .filter((p) => pinDisplayLabel(p).toLowerCase().includes(q))
        .map((p) => normalizeUrl(p.relayUrl)),
      ...joinedRooms
        .filter((e) => (e.name ?? "").toLowerCase().includes(q))
        .map((e) => normalizeUrl(e.relayUrl)),
    ]);
    return allCommunities.filter(
      (c) =>
        c.label.toLowerCase().includes(q)
        || c.url.toLowerCase().includes(q)
        // Petname too — renaming a community must not make it unfindable by
        // EITHER name (yours or the real one).
        || matchesQueryWith("community", c.url, c.label, q)
        || relaysWithMatchingRoom.has(normalizeUrl(c.url)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCommunities, searchFilter, roomPins, joinedRooms, petnamesVersion]);
  const sections = useMemo(
    () => (iaCollapsed ? sectionChatEntries(entries, communitiesForTab(dmTab, visibleCommunities), communityActivity) : []),
    [iaCollapsed, entries, dmTab, visibleCommunities, communityActivity],
  );
  // Under the collapsed IA a joined community IS content, so "nothing here" has
  // to count it. Gating on `entries` alone showed the "No conversations yet"
  // empty state to someone in a dozen communities who simply had no DMs yet.
  /**
   * Does PEOPLE exist as a heading right now?
   *
   * It is omitted when you have no primary DMs — a heading over nothing reads
   * as a bug. But the Requests row lives INSIDE that section, so the first
   * version of this made requests unreachable the moment your last primary DM
   * was demoted: People disappeared and took the only door to Requests with it.
   * The tab row it replaced was always on screen, so this was a regression the
   * restructure introduced rather than one it inherited.
   *
   * Requests are people. If there are any, PEOPLE exists.
   */
  const needsPeopleForRequests = needsSynthesizedPeopleSection(sections, dmTab, totalRequestCount);

  /** Requests is a view WITHIN the list, and owns the back control while it is
   *  open. Named once because three things now key off it. */
  const inRequestsView = dmTab === "requests" && !showDeleted;

  // ── The chat-home filter ───────────────────────────────────────────────────
  // Chips are derived from what is on screen, so the row appears only once
  // there are two kinds of chat to choose between and never offers a category
  // you have none of. `resolveChatFilter` is what keeps a stale choice — filter
  // to Communities, then leave your last one — from stranding you on a blank
  // page whose escape chip has vanished too.
  const [chatFilter, setChatFilter] = useState<ChatFilter>("all");
  const filterOptions = useMemo(
    () => chatFilterOptions(sections, dmTab === "primary" ? totalRequestCount : 0),
    [sections, dmTab, totalRequestCount],
  );
  const activeFilter = resolveChatFilter(chatFilter, filterOptions);
  const visibleSections = useMemo(() => applyChatFilter(sections, activeFilter), [sections, activeFilter]);
  // People is where the requests row lives, so the synthesized heading has to
  // survive the People filter and disappear under any other.
  const showRequestsOnlyPeople = needsPeopleForRequests && (activeFilter === "all" || activeFilter === "people");

  // ── Refresh ────────────────────────────────────────────────────────────────
  // `loading` is the WRONG signal for this button and always was. It flips false
  // the moment the IndexedDB cache paints — measured at 4ms — while the actual
  // refresh (querying the DM relays for new gift wraps, then decrypting them)
  // runs for up to 15 seconds afterward with nothing on screen to say so. The
  // spinner reported the cache read, so pressing Refresh looked like pressing a
  // dead button. `loadConversations` already resolves when the relay pass is
  // done; awaiting it is all that was needed to report the real operation.
  const [refreshing, setRefreshing] = useState(false);
  // The refresh result the header shows: null = idle, else the honest
  // outcome (was any DM relay actually reached?). See refresh-outcome.ts.
  const [refreshResult, setRefreshResult] = useState<RefreshOutcome | null>(null);
  const doRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshResult(null);
    const started = Date.now();
    // Probe reachability ALONGSIDE the fetch. loadConversations resolves even
    // offline (queryWithTimeout resolves on its timer; the no-signer path bails
    // after the IndexedDB read), so it cannot answer "did we reach anyone" —
    // this can. canReachAny measures the same pool sockets the fetch uses.
    const reachProbe = canReachAny(getMyDMReceiveRelays(pubkey)).catch(() => false);
    let reached = false;
    try {
      [reached] = await Promise.all([reachProbe, loadConversations()]);
    } finally {
      // A DISPLAY FLOOR, NOT A FAKE DURATION. The spin above now covers the real
      // operation and ends when it ends; this only holds the last frame long
      // enough to be seen, for the case where the whole pass resolves in a
      // couple of hundred milliseconds. Extending a finished state is a
      // legibility choice; ending one early would be a lie, and is what the old
      // `loading` flag did.
      const held = Math.max(0, 550 - (Date.now() - started));
      setTimeout(() => {
        setRefreshing(false);
        // The list usually looks IDENTICAL after a successful refresh, because
        // usually nothing new has arrived — so a confirmation is needed or the
        // honest all-clear is indistinguishable from a broken button. But the
        // confirmation must itself be honest: "Up to date" ONLY when a relay
        // answered; offline it says "Couldn't reach", never a silent all-clear.
        setRefreshResult(refreshOutcome(reached));
        setTimeout(() => setRefreshResult(null), 2200);
      }, held);
    }
  }, [refreshing, loadConversations, pubkey]);

  // On touch the SAME doRefresh is driven by the native pull idiom instead of
  // a button (the header refresh is desktop-only). The gesture math is pure
  // and pinned in lib/pull-to-refresh.test.ts; reach-honesty is unchanged —
  // the outcome line ("Up to date" / "Couldn't reach") renders either way.
  const { pullPx, pulling } = usePullToRefresh({
    targetRef: listScrollRef,
    enabled: isMobile,
    refreshing,
    onTrigger: doRefresh,
  });

  // Requests alone are enough to have something to show — otherwise an inbox
  // holding nothing BUT requests renders "no conversations yet" over five
  // people trying to reach you.
  const nothingToShow = iaCollapsed
    ? sections.length === 0 && !needsPeopleForRequests
    : entries.length === 0;
  // ── Private mode (the screen-share shield; lib/private-mode.ts) ────────────
  // People + Group rows blur; Communities stay legible (public places, private
  // people — the grilled Q1 call). While masked a row tap REVEALS instead of
  // navigating: one stray tap during a screen-share must never open a full
  // conversation. Blur is a screen shield, not encryption — the text is still
  // in the DOM; the DMs underneath are already encrypted.
  ensurePrivateModeRearm();
  const privateMasked = usePrivateMasked();
  /** Blur + intercept: the child renders normally (so layout never jumps),
   *  aria-hidden (a screen reader on a shared machine is the same leak), with
   *  a full-row transparent button on top that reveals — which also makes the
   *  row's own menus unreachable while masked, deliberately. */
  const MaskedRow = ({ children }: { children: React.ReactNode }) => (
    <div className="relative">
      <div className="blur-[6px] select-none" aria-hidden="true">{children}</div>
      <button
        type="button"
        className="absolute inset-0 w-full cursor-pointer"
        onClick={revealPrivateMasked}
        aria-label="Private mode — tap to show chats"
        data-testid="masked-row-reveal"
      />
    </div>
  );

  // One row, rendered the same whether the list is flat or sectioned.
  const renderEntry = (entry: ChatEntry) => {
                // A joined relay community. Deliberately quieter than the rows
                // above: no timestamp, no unread dot, because OutpostRelay
                // carries neither and inventing them would be a lie about
                // freshness. These rows answer "which places am I in", and they
                // sit in the order the user set by dragging on the Outposts
                // page — the same order they already know.
                if (entry.kind === "outpost") {
                  const o = entry.outpost;
                  // Whole set when the community itself matches (you asked for
                  // the place, so you get the place); only the matching rooms
                  // when it survived the filter BECAUSE of a room.
                  const q = searchFilter.trim().toLowerCase();
                  const relayKey = normalizeUrl(o.url);
                  const allPins = roomsByRelay.get(relayKey) ?? [];
                  const allJoined = joinedRoomsByRelay.get(relayKey) ?? [];
                  const communityMatches =
                    !q || o.label.toLowerCase().includes(q) || o.url.toLowerCase().includes(q);
                  const pins = communityMatches
                    ? allPins
                    : allPins.filter((p) => pinDisplayLabel(p).toLowerCase().includes(q));
                  const joinedScoped = communityMatches
                    ? allJoined
                    : allJoined.filter((e) => (e.name ?? "").toLowerCase().includes(q));
                  // Pins first in pin order, then the rooms you're in by
                  // recency; unread and timestamps only where the relay
                  // actually answered. All the rules live in room-entries.ts.
                  const { rows: roomRows, overflow: roomOverflow } = buildRoomRows({
                    pins: pins
                      .filter((p) => pinDisplayLabel(p) !== TAB_LABEL.channels)
                      .map((p) => ({ channelId: p.channelId!, id: p.id, label: pinDisplayLabel(p) })),
                    joined: joinedScoped,
                    activity: roomActivity.get(relayKey) ?? null,
                    lastReadOf: (gid) => readChannelLastRead(o.url, gid),
                  });
                  const pinByPinId = new Map(pins.map((p) => [p.id, p]));
                  const outpostBlock = (
                    <>
                    <button
                      type="button"
                      onClick={() => setLocation(`/outposts/${encodeURIComponent(o.url)}`)}
                      className="w-full flex items-center gap-3 px-3 min-h-[56px] text-left transition-colors hover:bg-primary/[0.04] active:bg-primary/[0.06]"
                      data-testid={`chat-outpost-${o.url}`}
                    >
                      {(() => {
                        const showReal = isShowingRealNames();
                        const pet = showReal ? undefined : getPetname("community", o.url);
                        const photo = showReal ? undefined : petnameImageUrlSync("community", o.url);
                        if (photo) {
                          return (
                            <img
                              src={photo}
                              alt=""
                              className="w-10 h-10 shrink-0 rounded-full object-cover border border-primary/20 select-none"
                              data-testid={`petname-photo-community-${normalizeUrl(o.url).slice(0, 16)}`}
                            />
                          );
                        }
                        return pet && (pet.emoji || pet.color) ? (
                          <span
                            className="w-10 h-10 shrink-0 rounded-full border border-primary/20 flex items-center justify-center text-lg select-none"
                            style={{ backgroundColor: pet.color ?? "hsl(var(--muted))" }}
                            data-testid={`petname-avatar-community-${normalizeUrl(o.url).slice(0, 16)}`}
                          >
                            {pet.emoji ?? o.label.slice(0, 1).toUpperCase()}
                          </span>
                        ) : (
                          <Avatar className="w-10 h-10 shrink-0 border border-primary/20">
                            <AvatarImage src={o.icon || undefined} alt="" />
                            <AvatarFallback className="bg-brand/10 text-[11px] text-brand">
                              {o.label.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        );
                      })()}
                      {/* Name + lock only, exactly like the Outposts card. The
                          relay hostname is deliberately absent: every other row
                          in this list puts a message teaser on the second line,
                          and a URL there reads as noise, not as content. */}
                      <span className="min-w-0 flex-1 flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">{displayNameWith("community", o.url, o.label)}</span>
                        {o.private && (
                          <Lock className="w-3 h-3 shrink-0 text-amber-600/70 dark:text-amber-400/70" />
                        )}
                      </span>
                    </button>
                    {/* The rooms inside THIS community, nested under it: the
                        member's pins first (Stage 2.8), then every room they
                        are actually in (kind-10009) by recency — the Stage-3
                        "rooms as first-class entries" item. Rendered inside the
                        parent's own return rather than as sibling entries in
                        the section array, so parent and child cannot be
                        separated by a future re-sort or by the virtualization
                        in the perf plan: they were never two items to reorder.

                        DELIBERATELY the outpost branch only, never the group
                        branch below. A group row opens a Concord community via
                        onOpenGroup; these rooms live on a relay and open
                        /outposts/<url>?tab=channels. Hanging them under a
                        Concord row would put two different chat systems in one
                        visual container and claim a containment that isn't real.
                        The cost is honest and worth naming: when a Concord space
                        claims a relay it suppresses that relay's bare row, so a
                        room pinned there has no parent here and stays absent —
                        today's behaviour, preserved in that one case rather than
                        replaced by a wrong one.

                        Timestamps and unread dots appear ONLY when the relay
                        answered (fetchRoomActivity is connection-gated); an
                        unreached relay renders these rows silent, exactly as
                        the Stage-2.8 comment demanded before trusting a clock
                        here. Silence that says nothing still beats a confident
                        lie — the difference is we can now tell the two apart. */}
                    {roomRows.map((row) => {
                      const Icon = TAB_ICON.channels;
                      const pin = row.pinId ? pinByPinId.get(row.pinId) : undefined;
                      return (
                        <div
                          key={row.groupId}
                          className="group flex items-center border-b border-border/10"
                        >
                          {/* The indent gutter carries the rule, so "inside"
                              reads as containment rather than as a shorter row
                              that happens to sit below. Same treatment and same
                              brand ink as the hub card and the sidebar tree. */}
                          <span className="w-[52px] shrink-0 self-stretch flex items-center justify-end pr-2" aria-hidden="true">
                            <span className="h-full w-px bg-border/40" />
                          </span>
                          <button
                            type="button"
                            onClick={() => setLocation(pin ? pinUrl(pin) : `/outposts/${encodeURIComponent(o.url)}?tab=channels&channel=${encodeURIComponent(row.groupId)}`)}
                            className="flex-1 min-w-0 flex items-center gap-2 py-2.5 pr-1 text-left transition-colors hover:bg-primary/[0.04] active:bg-primary/[0.06]"
                            // The parent name lives in the accessible name, not
                            // in a subtitle: these Communities rows are all one
                            // line, which is what keeps them visually distinct
                            // from the two-line "what just happened" rows above.
                            aria-label={`${row.name} — room in ${o.label}${row.unread ? ", new messages" : ""}`}
                            title={`${row.name} — room in ${o.label}`}
                            data-testid={`chat-room-${row.groupId.slice(0, 32)}`}
                          >
                            <Icon className="w-3 h-3 shrink-0 text-brand/70" />
                            <span className={`truncate text-sm ${row.unread ? "font-semibold text-foreground" : "text-foreground/90"}`}>{row.name}</span>
                            {row.unread && (
                              <span className="w-2 h-2 shrink-0 rounded-full bg-brand" data-testid={`chat-room-unread-${row.groupId.slice(0, 32)}`} />
                            )}
                          </button>
                          {typeof row.lastActivity === "number" && (
                            <span className="shrink-0 text-[11px] text-muted-foreground/70 tabular-nums pr-1">
                              {formatMessageTime(row.lastActivity)}
                            </span>
                          )}
                          {/* Unpin, here, because here is where the row appeared.
                              The only other pin control is back inside the
                              community's own room list, in another tab — so
                              without this the row arrives unbidden and cannot be
                              dismissed from where it showed up.

                              unpinRoomEverywhere, not unpinFeed: one pin press
                              writes TWO stores, and clearing only the shared one
                              removed this row while leaving the room pinned at
                              the top of its own list with a filled pin icon. A
                              half-unpin reads as the app ignoring you. It ends
                              by dispatching pinned-feeds-changed, which the
                              effect above already listens for, so the row
                              removes itself with no local state and the hub and
                              sidebar update in the same tick. Joined-but-unpinned
                              rows have no control here on purpose: their exit is
                              leaving the room, a decision that belongs on the
                              room's own screen, not a hover glyph in a list. */}
                          {pin && (
                            <button
                              type="button"
                              onClick={() => unpinRoomEverywhere(pin.relayUrl, pin.channelId!, pin.id)}
                              className="reveal-on-hover touch-target p-2 mr-1 shrink-0 text-muted-foreground/50 hover:text-foreground"
                              aria-label={`Unpin ${row.name}`}
                              title="Unpin"
                              data-testid={`chat-room-unpin-${pin.id.slice(0, 32)}`}
                            >
                              <PinOff className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {roomOverflow > 0 && (
                      // An honest count, not a lie of completeness: the cap
                      // keeps a 30-room membership from burying the list, and
                      // the way in to the rest is the room list this row opens.
                      <div className="flex items-center border-b border-border/10">
                        <span className="w-[52px] shrink-0 self-stretch flex items-center justify-end pr-2" aria-hidden="true">
                          <span className="h-full w-px bg-border/40" />
                        </span>
                        <button
                          type="button"
                          onClick={() => setLocation(`/outposts/${encodeURIComponent(o.url)}?tab=channels`)}
                          className="flex-1 min-w-0 py-2 pr-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                          data-testid={`chat-room-overflow-${normalizeUrl(o.url).slice(0, 24)}`}
                        >
                          {roomOverflow === 1 ? "1 more room" : `${roomOverflow} more rooms`}
                        </button>
                      </div>
                    )}
                    </>
                  );
                  // Masked, the WHOLE block blurs — parent row and nested room
                  // rows together (owner call, 2026-08-18, reversing the
                  // "communities are public places" carve-out): a community
                  // being public does not make YOUR membership public, plenty
                  // of outposts are private or encrypted, and a shield with
                  // one section still showing names reads as a bug — which is
                  // exactly how it was reported.
                  return privateMasked
                    ? <MaskedRow key={`outpost-${o.url}`}>{outpostBlock}</MaskedRow>
                    : <Fragment key={`outpost-${o.url}`}>{outpostBlock}</Fragment>;
                }
                if (entry.kind === "group") {
                  const g = entry.group;
                  // Concord community rows blur whole like every other row —
                  // the name-keeping special case died with the carve-out
                  // above; membership is the sensitive fact the eye exists to
                  // hide, public place or not.
                  const groupRow = (
                    <ChatListRow
                      key={`group-${g.communityId}`}
                      item={{ kind: "group", ...g, name: displayNameWith("group", g.communityId, g.name) }}
                      myPubkey={pubkey}
                      onOpenGroup={onOpenGroup}
                    />
                  );
                  return privateMasked ? <MaskedRow key={`group-${g.communityId}`}>{groupRow}</MaskedRow> : groupRow;
                }
                const conv = entry.conv;
                const profile = profiles.get(conv.pubkey) || null;
                const name = getDMDisplayName(profile, conv.pubkey);
                const isRequest = dmTab === "requests";
                const dmRow = (
                  <ChatListRow
                    key={conv.pubkey}
                    item={{ kind: "dm", ...conv }}
                    name={displayNameWith("person", conv.pubkey, name)}
                    profileName={profile?.display_name || profile?.name}
                    picture={profile?.picture}
                    nip05={profile?.nip05}
                    isSelected={selectedPubkey === conv.pubkey}
                    isRequest={isRequest}
                    hidePreviews={hidePreviews}
                    avatarOverride={isShowingRealNames() ? undefined : { ...getPetname("person", conv.pubkey), imageUrl: petnameImageUrlSync("person", conv.pubkey) }}
                    onOpen={navigateToConversation}
                    onOpenProfile={onOpenProfile}
                    onPromote={handlePromoteToPrimary}
                    onDemote={handleDemoteToRequests}
                    onRemove={onRemoveConversation}
                    onNickname={(pk) => setPetnameTarget({ kind: "person", id: pk, realName: name })}
                  />
                );
                return privateMasked ? <MaskedRow key={conv.pubkey}>{dmRow}</MaskedRow> : dmRow;
  };

  // Four surfaces render this list: this file's desktop dropdown, mobile sheet
  // and empty state, plus the Messages page's "Your messages" card. It lives in
  // create-actions.ts so none of them can quietly fall behind the others.
  const [createOpen, setCreateOpen] = useState(false);
  const createActions = buildCreateActions({
    canCreateGroup,
    onNewChat: () => setShowNewChat(true),
    onNewGroup: onNewGroupChat,
    onJoinLink: () => setShowJoinLink(true),
    onScanQr: () => setShowQrScan(true),
    onFindCommunity: () => setLocation("/outposts"),
  });

  return (
    <>
      {/* No "Messages" title — the bottom nav labels this tab. Back, the
          Primary/Requests filter, refresh, and compose share ONE row (below). */}
      {showNewChat && (
        <div className="p-3 border-b border-border/40 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Start a new conversation</p>
          <div className="relative">
            <div className="flex items-center gap-2">
              <SearchPill
                containerClassName="flex-1"
                placeholder="Search by name or handle…"
                value={newChatInput}
                onChange={(e) => setNewChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleNewChat(); }}
                autoFocus
                enterKeyHint="done"
                data-testid="input-new-chat-pubkey"
              />
              <Button size="sm" onClick={handleNewChat} disabled={!newChatInput.trim()} data-testid="button-start-chat">
                Start
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setShowNewChat(false); setNewChatInput(""); setUserSearchResults([]); }}
                data-testid="button-cancel-new-chat"
              >
                Cancel
              </Button>
            </div>

            {(userSearchResults.length > 0 || userSearching) && (
              <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-border/40 bg-background/95 backdrop-blur-md shadow-lg overflow-hidden max-h-[280px] overflow-y-auto" data-testid="container-user-search-results">
                {userSearchResults.map((result) => (
                  <button
                    key={result.pubkey}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left cursor-pointer"
                    onClick={() => handleSelectSearchResult(result.pubkey)}
                    data-testid={`button-search-result-${result.pubkey.slice(0, 8)}`}
                  >
                    <Avatar className="w-8 h-8 border border-border shrink-0">
                      <AvatarImage src={result.picture} alt={result.displayName || result.name} />
                      <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
                        {(result.displayName || result.name || "?").slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{result.displayName || result.name || "Unknown"}</div>
                      {result.nip05 && (
                        <Nip05Badge nip05={result.nip05} pubkey={result.pubkey} className="truncate" textClassName="text-[11px] text-primary/60" iconClassName="w-3 h-3" />
                      )}
                      {!result.nip05 && (
                        <div className="text-[11px] text-muted-foreground/50 font-mono truncate">
                          {nip19.npubEncode(result.pubkey).slice(0, 20)}...
                        </div>
                      )}
                    </div>
                  </button>
                ))}
                {userSearching && (
                  <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground/60">
                    <RelayOutpostInlineLoader className="w-3 h-3" />
                    Searching the network...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {pendingDecryptCount > 0 && (
        <div className="p-2 border-b border-border/20">
          <button
            onClick={decryptPending}
            disabled={decrypting}
            className="w-full flex items-center justify-center gap-2 rounded-md border border-brand/30 bg-brand/10 hover:bg-brand/15 px-3 py-2 text-xs font-medium text-brand transition-colors disabled:opacity-60"
            data-testid="button-decrypt-pending"
          >
            <Lock className={`w-3.5 h-3.5 ${decrypting ? "animate-pulse" : ""}`} />
            {decrypting
              ? "Decrypting…"
              : `Decrypt ${pendingDecryptCount} ${pendingDecryptCount === 1 ? "message" : "messages"}`}
          </button>
        </div>
      )}

      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/20 shrink-0">
        {/* NO page-level back arrow here (owner call, 2026-08-18): Chats is a
            bottom-bar root tab, and the arrow only did goBack("/") — a place
            the tab bar already goes in one tap. No messenger puts a back on
            its chat home; the one-arrow-per-screen doctrine caps at one, and a
            root tab's number is zero. Requests (a view WITHIN this list) keeps
            its own "← Requests" below — that one leaves Requests, not the
            page, and remains this screen's single arrow while it's open. */}
        {/* The Primary/Requests tab row used to live here.
            It was removed because it described the list wrongly: the body is
            already sectioned PEOPLE / GROUPS / COMMUNITIES, while the header
            offered two words that name neither. Worse, the split is a SAFETY
            boundary — "Requests" is DMs from outside your web of trust — so a
            tab row put a spam filter and a taxonomy on the same rail, and hid
            two thirds of the list to do it.
            The sections are the structure now, and requests are one row at the
            top of PEOPLE (see RequestsRow). `dmTab` survives as state, not as a
            tab: `dmTab === "requests"` is what renders the impersonation chip
            on a stranger's row, and losing that would be a silent safety
            regression rather than a layout change. */}
        {inRequestsView && !searchExpanded && (
          <button
            type="button"
            onClick={() => setDmTab("primary")}
            className="flex items-center gap-1.5 min-h-[44px] md:min-h-0 px-2 py-1 -ml-1 rounded-lg text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
            data-testid="button-requests-back"
          >
            <ArrowLeft className="w-4 h-4" />
            Requests
          </button>
        )}
        {/* Search lives IN this row now (was its own row above it, leaving the
            two buttons floating alone in a dead band on desktop). One row:
            search stretches, refresh stays a quiet utility inboard, and New —
            the button adoption depends on — keeps the corner every messenger
            trains people to reach for. Same gate as before: the pill only
            renders once there are enough rows to be worth searching
            (communities count — someone in a dozen communities with no DMs yet
            still needs the box); below that, a spacer holds the layout. */}
        {/* Always rendered (owner call, 2026-08-15): the old ">3 rows" gate
            swapped in an invisible spacer, which read as the controls floating
            right of a dead band on fresh accounts. Every messenger shows its
            search box from day one. */}
        <SearchPill
            ref={searchInputRef}
            containerClassName="flex-1 min-w-0"
            // Search results would surface names straight through the blur —
            // the one bypass that defeats the whole shield. Disabled, and says
            // why, until revealed.
            placeholder={privateMasked ? "Private mode" : "Search conversations..."}
            disabled={privateMasked}
            value={privateMasked ? "" : searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            data-testid="input-search-conversations"
          />
        {/* The way OUT of the expanded state: clears and collapses in one tap.
            onMouseDown preventDefault so the tap doesn't blur-then-miss — on
            touch the synthetic mousedown precedes both blur and click, and
            without this the button could collapse away before its own click
            lands (the ChatListRow touch-swallow lesson, from the other side). */}
        {searchExpanded && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setSearchFilter("");
              setSearchFocused(false);
              searchInputRef.current?.blur();
            }}
            className="shrink-0 min-h-[44px] md:min-h-0 px-2 text-sm font-medium text-brand hover:text-brand/80 transition-colors"
            data-testid="button-search-cancel"
          >
            Cancel
          </button>
        )}
        {/* While the search is in use this whole cluster stands down: width,
            opacity, AND visibility collapse (visibility so the hidden buttons
            leave the focus order and a11y tree, not just the paint). -ml-1.5
            swallows the row gap so Cancel sits flush at the edge. */}
        <div
          className={`flex items-center gap-1.5 min-w-0 overflow-hidden transition-[max-width,opacity,margin,visibility] duration-200 ${
            searchExpanded ? "max-w-0 opacity-0 invisible -ml-1.5" : "max-w-72 opacity-100 visible"
          }`}
        >
          {/* The real↔custom names glance moved to the filter row below
              (owner call, 2026-08-18): it is the rarest control that lived on
              this rail and only exists for people with petnames, so it was
              costing the most contested strip on the screen its calm. */}
          {/* The instant half of Private mode ("the eye hides your chats now;
              the setting makes them start hidden") — always present so the
              I'm-about-to-share-my-screen move is one tap, never a Settings
              trip. Wallet-balance idiom. */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 touch-target"
            onClick={togglePrivateMasked}
            aria-label={privateMasked ? "Show chats" : "Hide chats (private mode)"}
            title={privateMasked ? "Show chats" : "Hide chats (private mode)"}
            data-testid="button-private-mode"
          >
            {privateMasked
              ? <Eye className="w-4 h-4 text-brand" />
              : <EyeOff className="w-4 h-4 text-muted-foreground/70" />}
          </Button>
          {/* Desktop-only (owner call, 2026-08-18): touch drives the SAME
              doRefresh via pull-to-refresh on the list below — the native
              idiom — so the button would be a second spelling of one gesture.
              Desktop has no pull and keeps it. */}
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 touch-target"
              // Wrapped so the click event isn't passed as forceDecrypt — a plain
              // refresh must respect batched-decryption mode; the deliberate
              // decrypt pass has its own affordance (decryptPending in Messages).
              onClick={doRefresh}
              disabled={refreshing}
              aria-label={refreshing ? "Checking for new messages" : "Check for new messages"}
              title="Check for new messages"
              data-testid="button-refresh-conversations"
            >
              {refreshResult === "up-to-date"
                ? <Check className="w-4 h-4 text-emerald-500" data-testid="icon-refresh-done" />
                : refreshResult === "unreachable"
                  ? <RefreshCw className="w-4 h-4 text-amber-500" data-testid="icon-refresh-unreachable" />
                  : <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />}
            </Button>
          )}
          {/* min-w-0 + truncate, not shrink-0: this text now shares a row with
              the search pill, and the 2.2s confirmation must never push the New
              button off-screen on a phone. The icon (green check / amber) and
              the button's title carry the same state at every width. */}
          {refreshResult === "up-to-date" && (
            <span className="text-[11px] text-muted-foreground min-w-0 truncate" data-testid="text-refresh-done">Up to date</span>
          )}
          {refreshResult === "unreachable" && (
            <span className="text-[11px] text-amber-600 dark:text-amber-500 min-w-0 truncate" data-testid="text-refresh-unreachable">Couldn't reach — try again</span>
          )}
          {/* A LABELLED, FILLED CTA — not a ghost "+".
              Starting a conversation is the single most important action on an
              empty or near-empty chat home, and it was rendered as the lowest-
              emphasis control on the screen: a borderless icon in the top-right
              corner, the hardest spot to reach on a phone, with no word on it
              saying what it does. The behaviour behind it is unchanged (bottom
              drawer on touch, anchored dropdown on desktop); only its weight
              and its label are. */}
          {isMobile ? (
            <Button
              size="sm"
              className="h-9 gap-1.5 px-3 shrink-0 bg-[hsl(262_72%_52%)] hover:bg-[hsl(262_72%_46%)] text-white shadow-sm"
              onClick={() => setCreateOpen(true)}
              data-testid="button-new-chat"
            >
              <Plus className="w-4 h-4" />
              New
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-9 gap-1.5 px-3 shrink-0 bg-[hsl(262_72%_52%)] hover:bg-[hsl(262_72%_46%)] text-white shadow-sm" data-testid="button-new-chat">
                  <Plus className="w-4 h-4" />
                  New
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="glass-dropdown min-w-[230px]">
                {createActions.map(({ key, testId, Icon, label, desc, run }) => (
                  <DropdownMenuItem key={key} className="items-start gap-2.5 cursor-pointer py-2" onClick={run} data-testid={`menu-${testId}`}>
                    <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-tight">{label}</span>
                      <span className="block text-xs text-muted-foreground leading-snug">{desc}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* THE CHAT-HOME FILTER. One row, identical on desktop and mobile — the
          same chips, the same order, the same counts; only the horizontal
          scroll is a phone concession, and it is harmless on a wide screen.
          Self-hiding: `chatFilterOptions` returns nothing below two categories,
          so a new account with only DMs never sees a control that cannot do
          anything. Hidden entirely inside Requests and the deleted view, both
          of which are already a filtered slice — a filter within a filter is
          two controls fighting over one list. */}
      {(filterOptions.length > 0 || hasAnyPetnames()) && dmTab === "primary" && !showDeleted && (
        <div
          className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-border/20 shrink-0"
          data-testid="chat-filter-row"
        >
          {/* The tablist wraps ONLY the filters: the real-names glance below
              shares the row but is a toggle, not a tab, and putting it inside
              a tablist would announce it as one. The row itself renders when
              EITHER exists — a petname user with a single chat category still
              needs somewhere to find the glance. */}
          {filterOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 min-w-0" role="tablist" aria-label="Filter chats">
              {filterOptions.map((opt) => {
                const active = activeFilter === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setChatFilter(opt.key)}
                    className={`shrink-0 flex items-center gap-1.5 rounded-full border px-3 min-h-[36px] text-xs font-medium transition-colors ${
                      active
                        ? "border-primary/40 bg-primary/15 text-foreground"
                        : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    }`}
                    data-testid={`chat-filter-${opt.key}`}
                  >
                    {opt.label}
                    {/* Unread wins the slot when there is any: on a chat home the
                        question is "where is something waiting for me", not "how
                        many rows are down there". Falls back to the plain total so
                        the chip is never bare. */}
                    {opt.unread > 0 ? (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums">
                        {opt.unread}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/60 tabular-nums">{opt.count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {/* The real↔custom flip: one tap shows every subject's REAL name and
              avatar (session-only — a glance, not a mode). Moved here from the
              header rail (owner call, 2026-08-18) — it was the rarest control
              up there. Rendered ONLY when at least one petname exists; a
              real-names switch for someone who renamed nothing is a dead
              control. ml-auto keeps it visually apart from the filters: same
              row, different job. */}
          {hasAnyPetnames() && (
            <button
              type="button"
              onClick={toggleShowRealNames}
              aria-label={isShowingRealNames() ? "Show your names" : "Show real names"}
              title={isShowingRealNames() ? "Showing real names — tap for your names" : "Show real names"}
              aria-pressed={isShowingRealNames()}
              className={`ml-auto shrink-0 flex items-center gap-1.5 rounded-full border px-3 min-h-[36px] text-xs font-medium transition-colors ${
                isShowingRealNames()
                  ? "border-primary/40 bg-primary/15 text-foreground"
                  : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
              data-testid="button-show-real-names"
            >
              <BookUser className="w-3.5 h-3.5" />
              Real names
            </button>
          )}
        </div>
      )}

      {/* The reveal affordance — calm and in the brand voice, not a red lock:
          this shields a screen, it doesn't encrypt anything (that already
          happened underneath). Sits above the rows so the first thing a
          shared screen shows is the shield, not a beat of readable names. */}
      {privateMasked && (
        <button
          type="button"
          onClick={revealPrivateMasked}
          className="mx-3 mt-2 mb-1 flex items-center justify-center gap-2 rounded-lg border border-primary/25 bg-primary/[0.07] hover:bg-primary/[0.12] px-3 py-2 text-xs font-medium text-brand transition-colors"
          data-testid="private-mode-pill"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Private mode — tap to show
        </button>
      )}

      {(hiddenConvos.size > 0 || hiddenMsgIds.size > 0) && (
        <div className="flex items-center border-b border-border/20 px-1">
          <button
            onClick={() => setShowDeleted(false)}
            className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${!showDeleted ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="tab-active-messages"
          >
            Messages
          </button>
          <button
            onClick={() => setShowDeleted(true)}
            className={`flex-1 py-2 text-xs font-medium text-center transition-colors flex items-center justify-center gap-1.5 ${showDeleted ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
            data-testid="tab-deleted-messages"
          >
            <Archive className="w-3 h-3" />
            Deleted
            <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px] leading-none">
              {hiddenConvos.size + hiddenMsgIds.size}
            </span>
          </button>
        </div>
      )}

      {/* Remembering where you were is most of what "getting back to your chats"
          means. The wrapper around this list is display:none'd while a thread is
          open (Messages.tsx), which zeroes the scroll box — so without this the
          list snapped to the top every single time you backed out of a
          conversation, and you had to re-find your place. Save on scroll,
          restore when the list comes back. */}
      {/* Pull-to-refresh strip: tracks the finger (no transition while the
          pull is live — the strip must feel attached to it), springs on
          release, and holds a fixed height while the refresh runs. The icon
          flips at the commit point so "far enough" is visible before letting
          go. Feedback after the collapse is the header's existing outcome
          line — same reach-honest states as the desktop button. */}
      {isMobile && (
        <div
          style={{ height: `${indicatorHeight(pullPx, refreshing)}px` }}
          className={`shrink-0 overflow-hidden flex items-end justify-center ${pulling && !refreshing ? "" : "transition-[height] duration-200"}`}
          aria-hidden="true"
          data-testid="pull-refresh-strip"
        >
          <RefreshCw
            className={`w-4 h-4 mb-3 transition-transform duration-150 ${
              refreshing
                ? "animate-spin text-brand"
                : pullArmed(pullPx)
                  ? "rotate-180 text-brand"
                  : "text-muted-foreground/70"
            }`}
          />
        </div>
      )}
      <div
        ref={listScrollRef}
        onScroll={rememberListScroll}
        className="flex-1 overflow-y-auto overscroll-contain"
        data-testid="container-conversation-list"
      >
        {showDeleted ? (
          <div className="p-3 space-y-3">
            {hiddenConvos.size > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Removed conversations</p>
                <div className="space-y-1">
                  {Array.from(hiddenConvos).map((cpk) => {
                    const profile = profiles.get(cpk) || null;
                    const name = getDMDisplayName(profile, cpk);
                    return (
                      <div
                        key={cpk}
                        className="flex items-center gap-3 rounded-lg bg-muted/30 border border-border/20 overflow-hidden"
                        data-testid={`deleted-conv-${cpk.slice(0, 8)}`}
                      >
                        <button
                          className="flex-1 flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left min-w-0 cursor-pointer"
                          onClick={() => onPreviewDeletedConversation(cpk)}
                          data-testid={`button-preview-conv-${cpk.slice(0, 8)}`}
                        >
                          <Avatar className="w-8 h-8 border border-border shrink-0">
                            <AvatarImage src={profile?.picture} alt={name} />
                            <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
                              {name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <span className="text-sm truncate block">{name}</span>
                            <span className="text-[10px] text-muted-foreground/60">Tap to preview</span>
                          </div>
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 gap-1.5 text-xs h-7 mr-2"
                          onClick={() => handleRestoreConversation(cpk)}
                          data-testid={`button-restore-conv-${cpk.slice(0, 8)}`}
                        >
                          <Undo2 className="w-3 h-3" />
                          Restore
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {hiddenMsgIds.size > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Hidden messages</p>
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/30 border border-border/20">
                  <EyeOff className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm flex-1">{hiddenMsgIds.size} message{hiddenMsgIds.size !== 1 ? "s" : ""} hidden</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 gap-1.5 text-xs h-7"
                    onClick={onRestoreAllHiddenMessages}
                    data-testid="button-restore-all-messages"
                  >
                    <Undo2 className="w-3 h-3" />
                    Restore all
                  </Button>
                </div>
              </div>
            )}

            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs gap-1.5"
                onClick={handleClearAllHidden}
                data-testid="button-restore-all-deleted"
              >
                <Undo2 className="w-3 h-3" />
                Restore everything
              </Button>
            </div>
          </div>
        ) : pubkey && signer && !signer.nip44 ? (
          <div className="text-center py-12 px-4">
            <ShieldCheck className="w-10 h-10 mx-auto text-amber-500/60 mb-3" />
            <p className="text-sm font-medium text-foreground mb-1">NIP-44 Encryption Required</p>
            <p className="text-xs text-muted-foreground/80 max-w-[300px] mx-auto leading-relaxed">
              Private messages use NIP-17 gift wrap encryption for maximum privacy. Your current Nostr extension does not support NIP-44 encryption. Please use a compatible extension such as Alby, nos2x, or Nostore.
            </p>
          </div>
        ) : loading && entries.length === 0 ? (
          // Only take over the pane with the loader on a COLD load (nothing to
          // show yet). Once entries exist, a background refresh — the ⟳ button,
          // a reconnect, or an effect re-fire flipping `loading` true again —
          // must never blank the populated list; the spinning refresh icon is
          // the only "refreshing" signal. This is the mobile "list flashes then
          // goes blank" fix: keep cached conversations sticky across refreshes.
          <div className="flex flex-col items-center justify-center py-12">
            <RelayOutpostLoader size="md" label="Loading conversations..." />
            {loadingTooLong && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => loadConversations()}
                data-testid="button-retry-conversations"
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Retry
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Where-did-it-go map, once. It lives HERE rather than on Discover
                because opening the app now lands you here — the notice has to
                be on the page people actually arrive at, or it explains the
                move to nobody. Above the empty state as well as the list, since
                someone with no chats yet needs it most. Self-hiding. */}
            <IaMovedNotice className="mx-2 mt-2" />
            {/* Received group-chat invites — Accept lands you in the group and
                refreshes the merged list. Self-hides when there are none. */}
            {dmTab === "primary" && (
              <div className="p-2 pb-0 empty:hidden">
                {/* Under the collapsed IA these move to Activity — an invite is a
                    decision, and decisions surface there. Rendered in one place
                    only; two homes for one pending action is how you get an
                    invite accepted twice or missed entirely. */}
                {!iaCollapsed && <ConcordPendingInvites onAccepted={onReloadGroups} />}
              </div>
            )}
            {nothingToShow ? (
              <div className="text-center py-12 px-4">
                {dmTab === "primary" ? (
                  <>
                    <MessagesIcon className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground mb-1">
                      {searchFilter ? "No matches" : "No conversations yet"}
                    </p>
                    {searchFilter ? (
                      <p className="text-xs text-muted-foreground/80">Try a different search</p>
                    ) : (
                      <>
                        {/* Two panes, two jobs. This one is the INVENTORY, so
                            when it is empty it says what will live here — the
                            same shape the Requests tab beside it already uses.
                            The five ways to start belong to the detail pane,
                            which is the canvas and has the room for them.

                            They used to render in BOTH, so a desktop user saw
                            the identical five-item list twice, side by side, a
                            few hundred pixels apart. Not a styling slip: this
                            block was written for the phone, where the list IS
                            the whole screen and there is no second pane to
                            defer to. Which is why it stays below md. */}
                        <p className="hidden md:block text-xs text-muted-foreground/80">
                          Your chats, groups and communities will appear here
                        </p>
                        <div className="mx-auto mt-3 flex w-full max-w-[300px] flex-col gap-2 md:hidden">
                          {createActions.map(({ key, testId, Icon, label, desc, run }) => (
                            <button
                              key={key}
                              type="button"
                              onClick={run}
                              className="flex items-center gap-3 min-h-11 rounded-lg border border-border/50 bg-card/50 px-3.5 py-3 text-left transition-colors hover:bg-muted/50 cursor-pointer"
                              data-testid={`button-${testId}-empty`}
                            >
                              <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-foreground">{label}</span>
                                <span className="block text-xs text-muted-foreground">{desc}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Users className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground mb-1">
                      {searchFilter ? "No matches" : "No message requests"}
                    </p>
                    <p className="text-xs text-muted-foreground/80">
                      {searchFilter ? "Try a different search" : "Messages from people outside your network will appear here"}
                    </p>
                  </>
                )}
              </div>
            ) : (
            iaCollapsed ? (
              // Sectioned: membership is information a flat recency list throws
              // away. A DM and a 500-person community are different things to
              // scan for, even though they were never different OBJECTS.
              <>
              {showRequestsOnlyPeople && (
                <div key="people-requests-only">
                  <div className="px-3 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50" data-testid="chat-section-people">
                    People
                  </div>
                  {/* The count ("6 requests") is chat information too. */}
                  {privateMasked ? (
                    <MaskedRow>
                      <RequestsRow total={totalRequestCount} unread={requestUnreadCount} onOpen={() => {}} />
                    </MaskedRow>
                  ) : (
                    <RequestsRow
                      total={totalRequestCount}
                      unread={requestUnreadCount}
                      onOpen={() => setDmTab("requests")}
                    />
                  )}
                </div>
              )}
              {visibleSections.map((section) => (
                <div key={section.title}>
                  {/* The heading is dropped when a filter has already named the
                      category — the chip above says "Groups" in the active
                      state; repeating it as a heading over the only section on
                      screen is the same word twice. Under All it is the only
                      thing separating the three kinds, so it stays. */}
                  {activeFilter === "all" && (
                  <div className="px-3 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50" data-testid={`chat-section-${section.title.toLowerCase()}`}>
                    {section.title}
                  </div>
                  )}
                  {/* Requests lead PEOPLE, because that is what they are: people
                      trying to reach you who are not yet in your web of trust.
                      Deliberately ONE row that opens a filtered view rather than
                      an inline section — a stranger's name and message preview
                      rendered among your friends is the thing the split exists
                      to prevent, and it is a spam-and-abuse surface. */}
                  {section.title === "People" && dmTab === "primary" && totalRequestCount > 0 && (
                    privateMasked ? (
                      <MaskedRow>
                        <RequestsRow total={totalRequestCount} unread={requestUnreadCount} onOpen={() => {}} />
                      </MaskedRow>
                    ) : (
                      <RequestsRow
                        total={totalRequestCount}
                        unread={requestUnreadCount}
                        onOpen={() => setDmTab("requests")}
                      />
                    )
                  )}
                  {section.entries.map(renderEntry)}
                </div>
              ))}
              </>
            ) : (
              entries.map(renderEntry)
            )
            )}
          </>
        )}
      </div>

      {/* Mobile: the same options as desktop, but brought down to the thumb.
          The "+" lives in the top-right corner — the hardest place to reach on a
          phone — so the CHOICES open at the bottom rather than under the finger
          that opened them. Desktop keeps its anchored dropdown.

          Drawer, not Sheet. A bottom Sheet only closes via its X or the overlay
          — no drag — so the sheet felt stuck to anyone who reached for the swipe
          every other app has trained them to use. vaul's Drawer gives
          drag-to-dismiss (and the grab handle that advertises it) for free, and
          the app already uses it for the invite picker, so this adopts the
          existing convention rather than inventing one. */}
      {isMobile && (
        <Drawer open={createOpen} onOpenChange={setCreateOpen}>
          <DrawerContent className="max-h-[85vh] overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]" data-testid="chat-create-sheet">
            {/* Same treatment as every other section header in the app
                (DETAILS · CIRCLE · CONNECT WITH …): small, tracked, accent ink.
                It was reading as a page title in plain white, which made a
                sheet of five equal choices look like a screen of its own. */}
            <DrawerTitle className="text-[11px] font-brand font-semibold uppercase tracking-widest text-brand/90 mb-3">Start something new</DrawerTitle>
            <div className="flex flex-col gap-2">
              {createActions.map(({ key, testId, Icon, label, desc, run }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setCreateOpen(false); run(); }}
                  className="flex items-center gap-3 min-h-[52px] rounded-xl border border-border/50 bg-card/50 px-3.5 py-3 text-left transition-colors active:bg-muted/60"
                  data-testid={`sheet-${testId}`}
                >
                  {/* dark: variants are not optional here. In dark mode
                      --primary is 0 0% 95% — near-white, which is right for a
                      solid button (the white Follow) and wrong for an accent:
                      bare text-primary rendered these five icons as grey discs
                      with white glyphs and no brand colour anywhere in the
                      sheet. The explicit purple is the app's dark accent idiom. */}
                  <span className="flex items-center justify-center w-9 h-9 shrink-0 rounded-full bg-brand/10 text-brand dark:bg-brand/15">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{label}</span>
                    <span className="block text-xs text-muted-foreground">{desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </DrawerContent>
        </Drawer>
      )}

      {petnameTarget && (
        <PetnameDialog
          open={!!petnameTarget}
          onOpenChange={(open) => { if (!open) setPetnameTarget(null); }}
          kind={petnameTarget.kind}
          id={petnameTarget.id}
          realName={petnameTarget.realName}
        />
      )}
    </>
  );
}
