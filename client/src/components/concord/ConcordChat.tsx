/**
 * Concord encrypted-channel chat (Slice 2, public channels). Parallel to the
 * NIP-29 CommsTab — this one speaks Concord streams. Channel rail + message
 * list + composer. Messages decrypt symmetrically (no signer); sending needs
 * one signer.signEvent for the seal.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useBackClosable } from "@/hooks/use-back-closable";
import { createPortal } from "react-dom";
import { Hash, Lock, Plus, Send, ImagePlus, Loader2, X, CornerUpLeft, ChevronDown, Users, BellOff, MessageSquare, ArrowLeft, Link2, Shield } from "lucide-react";
import { getEventHash, nip19 } from "nostr-tools";
import { Link } from "wouter";
import { AuthorHoverCard } from "@/components/nostr-post/author-hover";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { persistentPoolSubscribe, publishEvent } from "@/lib/nostr";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { insertSorted, mergeCachedHistory } from "@/lib/message-list";
import { useToast } from "@/hooks/use-toast";
import { ComposeEmojiPicker } from "@/components/ComposeEmojiPicker";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useConcordProfile } from "./ConcordIdentity";
import { ConcordReactionPill } from "./ConcordReactionPill";
import { senderColor } from "@/lib/sender-color";
import { ConcordMediaView } from "./ConcordMediaView";
import { getCachedMessages, cacheMessage, getCachedReactions, cacheReaction, removeCachedReaction, type StoredCommunity, type StoredChannel, type CachedReaction } from "@/lib/concord/concord-keys";
import { liveChannels } from "@/lib/concord/concord-live-channels";
import { subscribeChannel, publishChannelMessage, publishTyping, subscribeTyping, type DecodedRumor } from "@/lib/concord/concord-stream";
import { buildMessageRumor, buildReplyRumor, buildReactionRumor, buildDeleteRumor, buildEditRumor, effectiveTime, hasPermission, PERM, KIND_REACTION, KIND_DELETE, KIND_EDIT, KIND_MESSAGE, type RumorTemplate } from "@/lib/concord/concord-events";
import { encryptAndUpload, mediaToTag, mediaFromTags, type ConcordMedia } from "@/lib/concord/concord-media";
import { useConcordGovernance } from "./useConcordGovernance";
import { ConcordInviteDialog } from "./ConcordInviteDialog";
import { canInviteToCommunity, rosterPubkeys } from "@/lib/concord/concord-invite-gate";
import { useMention } from "@/hooks/use-mention";
import { MentionSearch, type MentionResult } from "@/components/MentionSearch";
import { ConcordMessageBody, ConcordContentPreview, ConcordChannelNavProvider } from "./ConcordMessageBody";
import { buildChatTimeline, firstUnreadIndex, moderationSystemEvents, chatRowMeta, chatClockTime, type SystemAction } from "@/lib/concord/concord-activity";
import { groupThreads, type ThreadMeta } from "@/lib/concord/concord-threads";
import { useGoBack } from "@/hooks/use-go-back";
import { computeUnreadChannels, newestActivity, readChannelLastRead } from "@/lib/concord/concord-channel-unread";
import { getChannelWrapTimes, CHANGED_EVENT as UNREAD_CHANGED_EVENT, READ_EVENT } from "@/lib/concord/concord-unread";
import { isMuted, setChannelMuted, useMutedChannels, MUTE_CHANGED_EVENT } from "@/lib/concord/concord-mute";
import { mentionKey, useConcordMentionCounts } from "@/lib/concord/concord-mentions";
import { ConcordCreateChannelDialog } from "./ConcordCreateChannelDialog";
import { concordCapabilities, hasAnyCapability } from "@/lib/space-admin";
import { ConcordAdminDrawer } from "./ConcordAdminDrawer";
import { SpaceOverflowMenu } from "@/components/space/SpaceOverflowMenu";
import { ConcordMessageActions } from "./ConcordMessageActions";

interface ChatMsg { id: string; pubkey: string; content: string; t: number; media?: ConcordMedia[]; replyTo?: { id: string; pubkey: string }; rootId?: string; edited?: boolean; deleted?: boolean; mentions?: string[] }
/** Aggregated reactions for one message: emoji → who reacted + my reaction id. */
type ReactionAgg = { emoji: string; emojiUrl?: string; reactors: Set<string>; myId?: string };

/**
 * Per-channel unread dots for the sidebar/sheet. Latest-known activity per
 * channel = newest cached decrypted message (IDB) ∨ the group watcher's
 * metadata-only wrap clock, compared against the persisted per-channel read
 * marks (ro_concord_read_*, written by persistRead below). No new relay
 * traffic and nothing is decrypted for this.
 */
function useChannelUnread(
  pubkey: string | null | undefined,
  communityId: string,
  channels: StoredChannel[],
  activeChannelId: string | undefined,
): Set<string> {
  const [cachedLatest, setCachedLatest] = useState<ReadonlyMap<string, number>>(new Map());
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const channelIds = useMemo(() => channels.map((c) => c.id), [channels]);

  // One IDB pass per community/channel-set: newest cached message time each.
  useEffect(() => {
    if (!pubkey || channelIds.length < 2) return; // single-channel groups render no rail
    let cancelled = false;
    Promise.all(channelIds.map(async (id) => {
      const msgs = await getCachedMessages(pubkey, communityId, id);
      return [id, msgs.length ? msgs[msgs.length - 1].t : 0] as const;
    })).then((entries) => { if (!cancelled) setCachedLatest(new Map(entries)); });
    return () => { cancelled = true; };
  }, [pubkey, communityId, channelIds]);

  const recompute = useCallback(() => {
    const wraps = getChannelWrapTimes(communityId);
    const latest = new Map<string, number>();
    for (const id of channelIds) latest.set(id, newestActivity(cachedLatest.get(id), wraps.get(id)));
    const next = computeUnreadChannels(channelIds, latest, (id) => readChannelLastRead(communityId, id), activeChannelId);
    for (const id of [...next]) if (isMuted(communityId, id)) next.delete(id); // mute wins
    setUnread(next);
  }, [cachedLatest, channelIds, communityId, activeChannelId]);

  useEffect(() => { recompute(); }, [recompute]);
  // Wrap clock moved (new activity) / a read mark persisted / a mute flipped
  // → refresh the dots.
  useEffect(() => {
    window.addEventListener(UNREAD_CHANGED_EVENT, recompute);
    window.addEventListener(READ_EVENT, recompute);
    window.addEventListener(MUTE_CHANGED_EVENT, recompute);
    return () => {
      window.removeEventListener(UNREAD_CHANGED_EVENT, recompute);
      window.removeEventListener(READ_EVENT, recompute);
      window.removeEventListener(MUTE_CHANGED_EVENT, recompute);
    };
  }, [recompute]);

  return unread;
}

export function ConcordChat({ community, onCommunityChange, onOverview, onInvite, onLeave, onDissolve, viewportNudge, membersCollapsed, onToggleMembers, initialChannelId, createChannelOpen, onCreateChannelClose, embedded }: {
  community: StoredCommunity;
  onCommunityChange: (c: StoredCommunity) => void;
  /**
   * True when this chat is ONE SECTION of a page (the outpost Chat tab) rather
   * than the whole screen. Three things follow from owning the viewport or not:
   * the full-screen exit, the blank header band it leaves behind, and
   * `env(safe-area-inset-bottom)` — which is a viewport constant and means
   * nothing to an element that ends mid-page.
   */
  embedded?: boolean;
  /**
   * The HOST page's "New channel" button, forwarded down to the dialog that
   * actually exists. Channel creation lives in here, so a page-level button had
   * no way to reach it — the outpost page's was simply swallowed, leaving a
   * visible, enabled control that did nothing while the real one was a 24px `+`
   * in a rail that isn't always on screen.
   */
  createChannelOpen?: boolean;
  onCreateChannelClose?: () => void;
  /** Switch to the outpost overview (Members tab) — also a ⋯ menu item. */
  onOverview?: () => void;
  /** Open the existing invite dialog (present iff the viewer may invite). */
  onInvite?: () => void;
  /**
   * Open the host's LEAVE confirm. Correctly withheld from an owner — an owner
   * leaving is dissolving — which is why it must not double as dissolve.
   */
  onLeave?: () => void;
  /**
   * Open the host's DISSOLVE confirm. Separate from `onLeave` because aliasing
   * the two meant `onLeave={isOwner ? undefined : onLeave}` silently deleted
   * the owner's only way to end their own space: the drawer's danger section
   * gates on `!!onDissolve`, and under the absent-never-disabled doctrine its
   * silence ASSERTED the owner could not do it. On the Chats tab — the app's
   * landing destination — no host passed either, so both were gone.
   */
  onDissolve?: () => void;
  /** Land on this channel instead of the default (Chats-list unread deep-link). */
  initialChannelId?: string;
  /** Mobile keyboard height signal — re-pin the scroll when the pane resizes. */
  viewportNudge?: number | null;
  /** Desktop only: whether the host's persistent Members panel is collapsed.
   *  When defined, the desktop header shows a 👥 toggle wired to onToggleMembers. */
  membersCollapsed?: boolean;
  onToggleMembers?: () => void;
}) {
  const { pubkey } = useNostrAuth();
  const { state: govState, roster: govRoster, myMember, events: govEvents, auditLog } = useConcordGovernance(community);
  // Live channel list: local channels (with keys) + public channels the owner
  // added (folded from control editions; a member can derive their key), with
  // names kept current. Private channels only show if the member holds the key.
  //
  // Shared with the About-tab mount, which used to pass the raw record here and
  // so hid every channel a co-admin created — see concord-live-channels.ts.
  //
  // Deps stay narrow ON PURPOSE — the exact three inputs liveChannels reads,
  // never the whole `community`/`govState` objects. A new govState identity
  // arrives on every folded rumor, and widening this would rebuild `channels`
  // (and `activeChannel` under it) on each one: the message-resubscribe storm
  // PR #450 fixed, re-entered through a different door.
  const channels = useMemo<StoredChannel[]>(
    () => liveChannels(community, govState),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [community.channels, community.root_epoch, govState.channels],
  );
  // Single-channel groups read as plain group chats: no rail/picker, no
  // channel-name chrome. The rail/picker come back the moment a second
  // channel exists (everything below keys off channels.length).
  const single = channels.length === 1;
  const [activeId, setActiveId] = useState<string>(initialChannelId ?? community.channels[0]?.id ?? "");
  const activeChannel = useMemo<StoredChannel | undefined>(
    () => channels.find((c) => c.id === activeId) ?? channels[0],
    [channels, activeId],
  );
  const isOwner = pubkey === community.owner;
  const canManageChannels = isOwner || (!!myMember && hasPermission(myMember, PERM.MANAGE_CHANNELS));
  const [adminOpen, setAdminOpen] = useState(false);
  const caps = useMemo(() => concordCapabilities(myMember), [myMember]);
  // The invite door answers from in here when the host has none.
  //
  // The standalone page owns a ConcordInviteDialog and passes `onInvite`; the
  // outpost's Chat tab passes nothing, and used to get NO invite path at all —
  // the surface that creates a community could not put anyone in it. Rather
  // than teach a second host to compute authority, this component hosts the
  // dialog itself when nobody above it does, exactly like the Manage drawer.
  //
  // `canInviteToCommunity` fails closed until the fold seats this viewer; the
  // owner is decided locally, which is what lets the person who just created
  // the community invite immediately.
  const [inviteOpen, setInviteOpen] = useState(false);
  const canInvite = canInviteToCommunity({ community, pubkey, myMember, govMetadata: govState.metadata });
  const openInvite = onInvite ?? (canInvite ? () => setInviteOpen(true) : undefined);
  const unreadChannels = useChannelUnread(pubkey, community.community_id, channels, activeChannel?.id);
  // Tier 2/3: mention count badges + channel-level mutes for the switcher rows.
  const mentionCounts = useConcordMentionCounts();
  const mutedChannels = useMutedChannels(community.community_id);
  // Mobile collapses the channel rail behind the "#name ⌄" picker, so the
  // per-channel dots are invisible until the sheet is opened. Roll them up into
  // one signal ON the picker: a count badge when another channel has a mention,
  // else a plain dot when another channel simply has unread. (unreadChannels
  // already excludes the active channel and muted channels.)
  const otherChannelMentions = useMemo(
    () => channels.reduce(
      (sum, ch) => ch.id === activeChannel?.id ? sum : sum + (mentionCounts.get(mentionKey(community.community_id, ch.id)) ?? 0),
      0,
    ),
    [channels, activeChannel?.id, mentionCounts, community.community_id],
  );
  const otherChannelsUnread = unreadChannels.size > 0;
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [reactions, setReactions] = useState<Map<string, CachedReaction>>(new Map()); // reactionId → reaction
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [staged, setStaged] = useState<ConcordMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const goBackToChats = useGoBack();
  const [replyingTo, setReplyingTo] = useState<ChatMsg | null>(null);
  /** Open thread, by its starter message id (null = channel view). */
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  // Same @-mention typeahead + tokenizer as the main post/discussion composers
  // (useMention → MentionSearch → resolveContent/getMentionTags): picks insert
  // a display tag that resolveContent turns into a content-level nostr:npub1…
  // token at send time — the exact NIP-27 shape Armada sends, so mentions
  // interop both ways with zero protocol/tag-scheme change.
  const {
    mentionActive, mentionQuery, detectMention, insertMention, closeMention,
    resolveContent, getMentionTags, clearMentionTags,
  } = useMention();
  const [typing, setTyping] = useState<Set<string>>(new Set());
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastTypingSent = useRef(0);
  const [createOpen, setCreateOpen] = useState(false);
  // Host asked for the create dialog → open it, then immediately release the
  // host's flag so a second press works. Latching it instead would make the
  // button fire once per mount, which is its own version of "does nothing".
  useEffect(() => {
    if (!createChannelOpen) return;
    setCreateOpen(true);
    onCreateChannelClose?.();
  }, [createChannelOpen, onCreateChannelClose]);
  const [channelSheetOpen, setChannelSheetOpen] = useState(false);
  // Hand-rolled full-screen portal (not a Radix root), so it joins the
  // modal-back contract itself: Back closes the channel sheet, not the chat
  // under it (lib/modal-history.ts).
  useBackClosable(channelSheetOpen && !single, () => setChannelSheetOpen(false));
  // Canonical "go to channel" (used by the rail, the mobile sheet, and in-message
  // #channel links): switch the active channel + close the mobile picker sheet.
  const selectChannelById = useCallback((id: string) => {
    setActiveId(id);
    setChannelSheetOpen(false);
  }, []);
  // Provided to message bodies so an in-message #channel jumps here (not to the
  // global hashtag search). Only id + name — the resolver matches by name.
  const channelNav = useMemo(
    () => ({ channels: channels.map((c) => ({ id: c.id, name: c.name })), onSelect: selectChannelById }),
    [channels, selectChannelById],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (replyingTo) composerRef.current?.focus(); }, [replyingTo]);

  // Unread tracking: a per-channel last-read timestamp (localStorage). openLastRead
  // is captured on open so the "new messages" divider stays put as you read.
  const [atBottom, setAtBottom] = useState(true);
  const [openLastRead, setOpenLastRead] = useState(0);
  const messagesRef = useRef<ChatMsg[]>([]);
  messagesRef.current = messages;
  const readKey = activeChannel ? `ro_concord_read_${community.community_id}_${activeChannel.id}` : "";
  const persistRead = useCallback(() => {
    if (!readKey) return;
    const latest = messagesRef.current[messagesRef.current.length - 1]?.t ?? 0;
    try {
      if (latest) {
        localStorage.setItem(readKey, String(latest));
        // Let the global unread watcher clear this outpost's dot.
        window.dispatchEvent(new CustomEvent("concord-read", { detail: community.community_id }));
      }
    } catch {}
  }, [readKey, community.community_id]);
  useEffect(() => {
    if (!readKey) return;
    let v = 0; try { v = Number(localStorage.getItem(readKey)) || 0; } catch {}
    setOpenLastRead(v); setAtBottom(true);
  }, [readKey]);
  // Epoch a rumor must bind to — must match what subscribeChannel expects, or
  // routeRumor drops it (private channels bind to the channel epoch).
  const channelEpoch = activeChannel ? (activeChannel.isPrivate ? activeChannel.epoch : community.root_epoch) : 0;

  // Subscribe to the active channel. Load cached history first (survives tab
  // switches + reloads), then the live subscription only appends new messages.
  useEffect(() => {
    if (!pubkey || !activeChannel) return;
    let cancelled = false;
    const communityId = community.community_id;
    const channelId = activeChannel.id;
    // Deletes that arrived before their target (out-of-order / late join): keyed
    // targetId → author, applied the moment the target message/reaction shows up,
    // so "deleted for everyone" is reliable regardless of delivery order.
    const pendingDeletes = new Map<string, string>();
    setMessages([]); setReactions(new Map());
    // Merge — never replace: the live subscription can decode a new message
    // while these IDB reads are in flight, and its wrap is already in the
    // processed ledger. Clobbering state with the cached snapshot lost that
    // message until the next remount re-read the cache.
    getCachedMessages(pubkey, communityId, channelId).then((cached) => {
      if (!cancelled && cached.length) setMessages((prev) => mergeCachedHistory(cached, prev, (m) => m.id, (m) => m.t));
    });
    getCachedReactions(pubkey, communityId, channelId).then((cached) => {
      if (!cancelled && cached.length) setReactions((prev) => {
        const next = new Map<string, CachedReaction>(cached.map((r) => [r.id, r]));
        for (const [id, r] of prev) next.set(id, r); // live wins on conflict
        return next;
      });
    });
    const onMessage = (rumor: DecodedRumor) => {
      if (rumor.kind === KIND_REACTION) {
        const targetId = rumor.tags.find((t) => t[0] === "e")?.[1];
        if (!targetId) return;
        if (pendingDeletes.get(rumor.id) === rumor.pubkey) return; // was un-reacted before it arrived
        const emojiTag = rumor.tags.find((t) => t[0] === "emoji");
        const r: CachedReaction = { id: rumor.id, pubkey: rumor.pubkey, targetId, emoji: rumor.content, emojiUrl: emojiTag?.[2], t: effectiveTime(rumor) };
        void cacheReaction(pubkey, communityId, channelId, r);
        setReactions((prev) => { if (prev.has(r.id)) return prev; const next = new Map(prev); next.set(r.id, r); return next; });
        return;
      }
      if (rumor.kind === KIND_DELETE) {
        const targetId = rumor.tags.find((t) => t[0] === "e")?.[1];
        if (!targetId) return;
        pendingDeletes.set(targetId, rumor.pubkey); // catch a target that arrives later
        // A delete targets either a reaction (un-react) or a message (tombstone).
        setReactions((prev) => {
          const target = prev.get(targetId);
          if (!target || target.pubkey !== rumor.pubkey) return prev; // only the author can delete
          void removeCachedReaction(pubkey, targetId);
          const next = new Map(prev); next.delete(targetId); return next;
        });
        setMessages((prev) => prev.map((m) => {
          if (m.id !== targetId || m.pubkey !== rumor.pubkey || m.deleted) return m; // only the author
          const del = { ...m, deleted: true, content: "", media: undefined };
          void cacheMessage(pubkey, communityId, channelId, del);
          return del;
        }));
        return;
      }
      if (rumor.kind === KIND_EDIT) {
        const targetId = rumor.tags.find((t) => t[0] === "e")?.[1];
        if (!targetId) return;
        setMessages((prev) => prev.map((m) => {
          if (m.id !== targetId || m.pubkey !== rumor.pubkey || m.deleted) return m; // only the author
          const ed = { ...m, content: rumor.content, edited: true };
          void cacheMessage(pubkey, communityId, channelId, ed);
          return ed;
        }));
        return;
      }
      const media = mediaFromTags(rumor.tags);
      const parentId = rumor.tags.find((t) => t[0] === "e")?.[1];
      const parentPk = rumor.tags.find((t) => t[0] === "p")?.[1];
      const replyTo = parentId && parentPk ? { id: parentId, pubkey: parentPk } : undefined;
      // Thread root (NIP-22 uppercase `E`) — what the reply belongs UNDER, as
      // opposed to `e`, the single message it answers. Older replies that only
      // carry `e` fall back to their parent, which is the same thing whenever
      // the parent is itself a thread starter.
      const rootId = rumor.tags.find((t) => t[0] === "E")?.[1] ?? parentId;
      const mentions = rumor.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]);
      let msg: ChatMsg = { id: rumor.id, pubkey: rumor.pubkey, content: rumor.content, t: effectiveTime(rumor), media: media.length ? media : undefined, replyTo, rootId, mentions: mentions.length ? mentions : undefined };
      // Apply a delete that landed before this message did.
      if (pendingDeletes.get(msg.id) === msg.pubkey) msg = { ...msg, deleted: true, content: "", media: undefined };
      void cacheMessage(pubkey, communityId, channelId, msg);
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return insertSorted(prev, msg, (m) => m.t);
      });
      // Calm rules: no mention toast — you're already looking at this channel;
      // cross-channel mentions surface as quiet count badges (concord-mentions).
    };
    const sub = subscribeChannel(pubkey, community, activeChannel, onMessage, (relays, filter, onevent) =>
      persistentPoolSubscribe(relays, filter, { onevent }),
    );
    // Foreground/online catch-up: a socket that died while the tab was hidden
    // or offline can miss wraps even with the self-healing subscription (a
    // zombie socket is only detected on the next keepalive). On return, run a
    // one-shot since-bounded pass over the channel plane — the stream ledger
    // makes replayed wraps free, and only genuinely missed ones decode.
    const catchUpSubs: { close: () => void }[] = [];
    const catchUp = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      const newest = messagesRef.current[messagesRef.current.length - 1]?.t ?? 0; // ms
      const since = newest
        ? Math.floor(newest / 1000) - 3600 // 1h overlap absorbs clock skew
        : Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
      let done = false;
      const oneShot = subscribeChannel(pubkey, community, activeChannel, onMessage, (relays, filter, onevent) =>
        persistentPoolSubscribe(relays, { ...filter, since }, {
          onevent,
          oneose: () => { if (!done) { done = true; setTimeout(() => oneShot.close(), 0); } },
        }),
      );
      catchUpSubs.push(oneShot);
    };
    const onVisible = () => { if (document.visibilityState === "visible") catchUp(); };
    window.addEventListener("online", catchUp);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      sub.close();
      window.removeEventListener("online", catchUp);
      document.removeEventListener("visibilitychange", onVisible);
      for (const s of catchUpSubs) { try { s.close(); } catch {} }
    };
  }, [pubkey, community, activeChannel]);

  // Ephemeral typing stream (separate subscription; nothing persisted).
  useEffect(() => {
    if (!activeChannel) return;
    const timers = typingTimers.current;
    const sub = subscribeTyping(community, activeChannel, (pk) => {
      if (pk === pubkey) return;
      setTyping((prev) => prev.has(pk) ? prev : new Set(prev).add(pk));
      const t = timers.get(pk); if (t) clearTimeout(t);
      timers.set(pk, setTimeout(() => { setTyping((prev) => { const n = new Set(prev); n.delete(pk); return n; }); timers.delete(pk); }, 5000));
    }, (relays, filter, onevent) => persistentPoolSubscribe(relays, filter, { onevent }));
    return () => { sub.close(); timers.forEach(clearTimeout); timers.clear(); setTyping(new Set()); };
  }, [pubkey, community, activeChannel]);

  const notifyTyping = useCallback(() => {
    const signer = getGlobalSigner();
    if (!signer || !pubkey || !activeChannel) return;
    const now = Date.now();
    if (now - lastTypingSent.current < 3000) return; // throttle
    lastTypingSent.current = now;
    void publishTyping(signer, pubkey, community, activeChannel, (e, relays) => publishEvent(e, relays));
  }, [pubkey, community, activeChannel]);

  // On a channel's FIRST message-load (open / switch) jump to the bottom
  // instantly — otherwise the whole backlog visibly smooth-scrolls past every
  // time you enter a channel. Smooth is reserved for messages arriving while
  // you're already reading at the bottom.
  const initialScrolledRef = useRef<string>("");
  useEffect(() => {
    if (!atBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    const key = activeChannel?.id ?? "";
    const firstLoad = initialScrolledRef.current !== key && messages.length > 0;
    el.scrollTo({ top: el.scrollHeight, behavior: firstLoad ? "auto" : "smooth" });
    if (messages.length > 0) initialScrolledRef.current = key;
    persistRead();
  }, [messages, atBottom, persistRead, activeChannel?.id]);

  // Keyboard open/close resizes the fixed pane — keep the latest message pinned
  // above the composer instead of stranding the scroll mid-list (DM behavior).
  useEffect(() => {
    if (viewportNudge != null) requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, [viewportNudge]);

  const onMessagesScroll = useCallback(() => {
    const el = scrollRef.current; if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(bottom);
    if (bottom) persistRead();
  }, [persistRead]);
  const jumpToLatest = useCallback(() => {
    setAtBottom(true);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    persistRead();
  }, [persistRead]);

  // Combined timeline: messages + system lines (only in the default channel,
  // à la Discord's system channel) interleaved by time. System lines are
  // joins/leaves + NEUTRAL moderation outcomes ("[name] was removed/banned by
  // an admin" — no reason in-channel; that stays in the admin audit log).
  // Role changes (promote/demote) deliberately produce no line.
  const isDefaultChannel = !!activeChannel && activeChannel.id === channels[0]?.id;
  // Threads: replies collapse out of the channel and live under their starter,
  // which stays in place with a "N replies" chip. A reply whose starter isn't in
  // this channel keeps rendering inline (groupThreads' fallback) — never hidden.
  const threading = useMemo(() => groupThreads(messages), [messages]);
  const timeline = useMemo(
    () => buildChatTimeline(threading.timeline, [...govEvents, ...moderationSystemEvents(auditLog)], isDefaultChannel),
    [threading.timeline, govEvents, auditLog, isDefaultChannel],
  );
  // First timeline item newer than where we left off → the "New" divider slot.
  const firstUnreadIdx = firstUnreadIndex(timeline, openLastRead);
  // Per-row date dividers + Discord-style author grouping. `nowTick` advances on
  // each new message so "Today/Yesterday" labels stay honest across midnight
  // without a render-time Date.now() (which would thrash the memo every frame).
  const nowTick = useMemo(() => Date.now(), [timeline.length]);
  const rowMeta = useMemo(() => chatRowMeta(timeline, nowTick), [timeline, nowTick]);

  const send = useCallback(async () => {
    // `raw` keeps the display text ("@Name" + invisible tokens) for failure
    // restore; `text` is what actually travels — mention display tags resolved
    // to content-level nostr:npub1… (NIP-27, Armada-compatible).
    const raw = draft;
    const text = resolveContent(raw).trim();
    const signer = getGlobalSigner();
    if ((!text && !staged) || !pubkey || !signer || !activeChannel) return;
    setSending(true);
    setDraft("");
    const outgoing = staged; setStaged(null);
    const parent = replyingTo; setReplyingTo(null);
    const mentions = getMentionTags(raw).map((t) => t[1]);
    const ms = Math.floor((Date.now() % 1000));
    const now = Math.floor(Date.now() / 1000);
    const rumor = parent
      ? buildReplyRumor(pubkey, activeChannel.id, BigInt(channelEpoch), text, ms, now, {
          rootKind: KIND_MESSAGE, rootId: parent.id, rootPubkey: parent.pubkey,
          parentKind: KIND_MESSAGE, parentId: parent.id, parentPubkey: parent.pubkey,
        })
      : buildMessageRumor(pubkey, activeChannel.id, BigInt(channelEpoch), text, ms, now);
    // p-tags on the rumor (inside the encrypted content) keep in-app mention
    // notifications + row highlight working — same rumor-tag scheme as before.
    for (const pk of mentions) if (!rumor.tags.some((t) => t[0] === "p" && t[1] === pk)) rumor.tags.push(["p", pk]);
    if (outgoing) rumor.tags.push(mediaToTag(outgoing));
    const wrap = await publishChannelMessage(signer, pubkey, community, activeChannel, rumor, (e, relays) => publishEvent(e, relays));
    if (!wrap) {
      // Restore on failure (mention entries kept) AND SAY SO.
      //
      // `publishToPlane` does the hard part correctly — it returns null when
      // zero relays accepted the wrap, rather than reporting success on a
      // fire-and-forget. All of that verdict was then thrown away here: the
      // text reappeared in the composer with no toast and no retry, so a
      // genuine total-relay-failure was indistinguishable from a button that
      // does nothing. The NIP-29 path next door has always rolled back *and*
      // toasted (CommsTab handleSend); this is the same treatment.
      setDraft(raw); setStaged(outgoing); setReplyingTo(parent);
      toast({
        title: "Couldn't send",
        description: "No relay accepted the message. Your text is back in the box — try again.",
        variant: "destructive",
      });
    }
    else clearMentionTags();
    setSending(false);
  }, [draft, staged, replyingTo, pubkey, activeChannel, community, channelEpoch, resolveContent, getMentionTags, clearMentionTags, toast]);

  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  // A thread takes the right slot, so on desktop it stands in for the Members
  // panel rather than squeezing a fourth column — and hands the slot back when
  // the thread closes (only if WE collapsed it).
  const restoreMembersRef = useRef(false);
  const openThread = useCallback((rootId: string) => {
    if (onToggleMembers && membersCollapsed === false) { restoreMembersRef.current = true; onToggleMembers(); }
    setThreadRootId(rootId);
  }, [onToggleMembers, membersCollapsed]);
  const closeThread = useCallback(() => {
    setThreadRootId(null);
    if (restoreMembersRef.current) { restoreMembersRef.current = false; onToggleMembers?.(); }
  }, [onToggleMembers]);
  // Switching channels leaves any open thread behind — its messages are gone.
  useEffect(() => { setThreadRootId(null); restoreMembersRef.current = false; }, [activeChannel?.id]);
  const threadRoot = threadRootId ? messagesById.get(threadRootId) : undefined;
  // A starter that got deleted (or fell out of the window) closes the panel
  // rather than stranding the reader on an empty pane.
  useEffect(() => { if (threadRootId && !threadRoot) closeThread(); }, [threadRootId, threadRoot, closeThread]);

  const onDraftChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDraft(value);
    detectMention(value, e.target.selectionStart ?? value.length);
    if (value.trim()) notifyTyping();
  }, [detectMention, notifyTyping]);
  const handleMentionSelect = useCallback((result: MentionResult) => {
    // insertMention only touches selectionStart/End + focus, which the chat's
    // <input> shares with a textarea — the ref cast is shape-safe.
    setDraft((cur) => insertMention(result, cur, composerRef as unknown as React.RefObject<HTMLTextAreaElement | null>));
  }, [insertMention]);

  // Reactions grouped by message → emoji, with my reaction id for toggling.
  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, Map<string, ReactionAgg>>();
    for (const r of reactions.values()) {
      let byEmoji = map.get(r.targetId);
      if (!byEmoji) { byEmoji = new Map(); map.set(r.targetId, byEmoji); }
      let agg = byEmoji.get(r.emoji);
      if (!agg) { agg = { emoji: r.emoji, emojiUrl: r.emojiUrl, reactors: new Set() }; byEmoji.set(r.emoji, agg); }
      agg.reactors.add(r.pubkey);
      if (r.pubkey === pubkey) agg.myId = r.id;
    }
    return map;
  }, [reactions, pubkey]);

  const toggleReaction = useCallback(async (target: { id: string; pubkey: string }, emoji: string, emojiUrl?: string) => {
    const signer = getGlobalSigner();
    if (!pubkey || !signer || !activeChannel) return;
    const mine = reactionsByMessage.get(target.id)?.get(emoji)?.myId;
    const ms = Math.floor(Date.now() % 1000);
    const now = Math.floor(Date.now() / 1000);
    let rumor: RumorTemplate;
    if (mine) {
      rumor = buildDeleteRumor(pubkey, activeChannel.id, BigInt(channelEpoch), mine, ms, now);
      setReactions((prev) => { const next = new Map(prev); next.delete(mine); return next; }); // optimistic
      void removeCachedReaction(pubkey, mine);
    } else {
      rumor = buildReactionRumor(pubkey, activeChannel.id, BigInt(channelEpoch), emoji, target, ms, now, emojiUrl ? { shortcode: emoji, url: emojiUrl } : undefined);
      const id = getEventHash({ ...rumor } as never);
      const r: CachedReaction = { id, pubkey, targetId: target.id, emoji, emojiUrl, t: now * 1000 + ms };
      setReactions((prev) => { const next = new Map(prev); next.set(id, r); return next; }); // optimistic
      void cacheReaction(pubkey, community.community_id, activeChannel.id, r);
    }
    await publishChannelMessage(signer, pubkey, community, activeChannel, rumor, (e, relays) => publishEvent(e, relays)).catch(() => null);
  }, [pubkey, activeChannel, community, channelEpoch, reactionsByMessage]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ChatMsg | null>(null);
  const publishMut = useCallback((rumor: RumorTemplate) => {
    const signer = getGlobalSigner();
    if (!signer || !activeChannel) return;
    void publishChannelMessage(signer, pubkey!, community, activeChannel, rumor, (e, relays) => publishEvent(e, relays)).catch(() => null);
  }, [pubkey, activeChannel, community]);

  const deleteMessage = useCallback((msg: ChatMsg) => {
    if (!pubkey || !activeChannel || msg.pubkey !== pubkey) return;
    const ms = Math.floor(Date.now() % 1000), now = Math.floor(Date.now() / 1000);
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, deleted: true, content: "", media: undefined } : m)); // optimistic
    void cacheMessage(pubkey, community.community_id, activeChannel.id, { ...msg, deleted: true, content: "", media: undefined });
    publishMut(buildDeleteRumor(pubkey, activeChannel.id, BigInt(channelEpoch), msg.id, ms, now));
  }, [pubkey, activeChannel, community, channelEpoch, publishMut]);

  const saveEdit = useCallback((msg: ChatMsg, text: string) => {
    const trimmed = text.trim();
    setEditingId(null);
    if (!pubkey || !activeChannel || msg.pubkey !== pubkey || !trimmed || trimmed === msg.content) return;
    const ms = Math.floor(Date.now() % 1000), now = Math.floor(Date.now() / 1000);
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, content: trimmed, edited: true } : m)); // optimistic
    void cacheMessage(pubkey, community.community_id, activeChannel.id, { ...msg, content: trimmed, edited: true });
    publishMut(buildEditRumor(pubkey, activeChannel.id, BigInt(channelEpoch), msg.id, trimmed, ms, now));
  }, [pubkey, activeChannel, community, channelEpoch, publishMut]);

  // Encrypt + upload a picked file, then stage it for the next send.
  const pickFile = useCallback(async (file: File | undefined) => {
    const signer = getGlobalSigner();
    if (!file || !signer) return;
    setUploading(true);
    try {
      const media = await encryptAndUpload(file, signer);
      setStaged(media);
    } catch (err) {
      toast({ title: "Couldn't attach file", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [toast]);



  return (
    <div className="relative flex flex-1 min-h-0 md:rounded-xl md:border md:border-border/30 overflow-hidden" data-testid="concord-chat">
      {/* Desktop channel sidebar — hidden while the group has one channel */}
      {!single && (
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border/20 bg-muted/5 dark:bg-black/10" data-testid="concord-channel-sidebar">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/20 shrink-0">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Rooms</span>
          {canManageChannels && (
            <button onClick={() => setCreateOpen(true)} className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/50 hover:text-brand hover:bg-brand/10 transition-colors" title="New room" data-testid="concord-add-channel">
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {channels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setActiveId(ch.id)}
              className={`flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-lg text-sm text-left transition-colors ${
                ch.id === activeChannel?.id ? "bg-accent text-accent-foreground dark:bg-brand/15 dark:text-brand font-medium" : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/30"
              } ${mutedChannels.has(ch.id) ? "opacity-50" : ""}`}
              data-testid={`concord-channel-side-${ch.id.slice(0, 8)}`}
            >
              {ch.isPrivate ? <Lock className="w-3.5 h-3.5 shrink-0 opacity-60" /> : <Hash className="w-3.5 h-3.5 shrink-0 opacity-60" />}
              <span className="truncate flex-1">{ch.name}</span>
              <ChannelRowSignal
                muted={mutedChannels.has(ch.id)}
                mentions={mentionCounts.get(mentionKey(community.community_id, ch.id)) ?? 0}
                unread={unreadChannels.has(ch.id)}
                onUnmute={() => setChannelMuted(community.community_id, ch.id, false)}
                testId={`concord-channel-dot-${ch.id.slice(0, 8)}`}
              />
            </button>
          ))}
        </div>
      </aside>
      )}

      {/* Message pane */}
      <div className="relative flex flex-col flex-1 min-w-0 min-h-0">
      {/* Mobile chat header: back · channel picker (sheet) · members · settings.
          Identity + invite live in the app top bar above this. The back arrow is
          NOT redundant with that bar's: the generic one falls back to the Feed,
          so leaving a group chat dumped you somewhere you never asked to go.
          This one always returns to Chats, matching the DM thread. */}
      <div className={`flex md:hidden items-center gap-0.5 px-2 ${embedded ? "py-1" : "py-1.5"} border-b border-border/20 shrink-0`}>
        {!embedded && (
        <button
          onClick={() => goBackToChats("/messages")}
          className="flex items-center justify-center w-11 h-11 shrink-0 rounded-lg text-muted-foreground active:bg-muted/30 transition-colors"
          aria-label="Back to chats"
          title="Back to chats"
          data-testid="concord-back-to-chats"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        )}
        {single ? (
          // One channel → nothing to pick. Standalone, a spacer keeps the row's
          // shape around the back arrow; embedded there is no back arrow to
          // balance, so the spacer would just be 44px of blank band.
          !embedded && <div className="min-w-0 flex-1 h-10" aria-hidden="true" />
        ) : (
        <button onClick={() => setChannelSheetOpen(true)} className="flex items-center gap-1.5 min-w-0 flex-1 h-10 px-2 rounded-lg text-left active:bg-muted/30 transition-colors" data-testid="concord-channel-picker">
          {activeChannel?.isPrivate ? <Lock className="w-4 h-4 shrink-0 text-muted-foreground/50" /> : <Hash className="w-4 h-4 shrink-0 text-muted-foreground/50" />}
          <span className="text-sm font-semibold truncate">{activeChannel?.name}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground/50" />
          {otherChannelMentions > 0 ? (
            <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shrink-0" aria-label={`${otherChannelMentions} mention${otherChannelMentions === 1 ? "" : "s"} in other channels`} data-testid="concord-picker-mentions">
              {otherChannelMentions > 9 ? "9+" : otherChannelMentions}
            </span>
          ) : otherChannelsUnread ? (
            <span className="w-2 h-2 rounded-full bg-primary shrink-0 shadow-[0_0_6px_rgba(139,92,246,0.6)]" aria-label="Unread messages in other channels" data-testid="concord-picker-unread" />
          ) : null}
        </button>
        )}
        {onOverview && (
          <button onClick={onOverview} className="flex items-center justify-center w-10 h-10 rounded-full text-muted-foreground/60 hover:text-foreground active:bg-muted/40 transition-colors" title="Members & about" data-testid="concord-chat-overview">
            <Users className="w-[18px] h-[18px]" />
          </button>
        )}
        {/* Labelled, and OUT of the ⋯ — the same retirement the NIP-29 header
            got. Concord never had NIP-29's eight doors; it had the opposite
            problem, one door that only announced itself once you opened a menu
            to look for it. `ml-auto` moves here so the ⋯ still trails the row
            when this button is absent for a plain member. */}
        {hasAnyCapability(caps) && (
          <button
            onClick={() => setAdminOpen(true)}
            className="ml-auto flex items-center gap-1.5 h-9 px-2.5 shrink-0 rounded-lg text-xs font-medium text-brand active:bg-brand/10 transition-colors"
            data-testid="concord-manage-mobile"
          >
            <Shield className="w-3.5 h-3.5" />
            Manage
          </button>
        )}
        <SpaceOverflowMenu
          triggerClassName={`${hasAnyCapability(caps) ? "" : "ml-auto "}flex items-center justify-center w-11 h-11 rounded-full text-muted-foreground/60 hover:text-foreground active:bg-muted/40 transition-colors`}
          triggerIconClassName="w-[18px] h-[18px]"
          triggerTestId="concord-channel-settings-mobile"
          onManage={undefined}
          onMembers={onOverview}
          onInvite={openInvite}
          onLeave={isOwner ? undefined : onLeave}
          petnameSubject={{ kind: "group", id: community.community_id, realName: community.name }}
          isOwner={isOwner}
          muteContext={{ communityId: community.community_id, channelId: single ? undefined : activeChannel?.id, channelName: activeChannel?.name }}
        />
      </div>
      {/* Mobile channel sheet (above the z-[55] chat overlay, below z-[210] dialogs) */}
      {channelSheetOpen && !single && typeof document !== "undefined" && createPortal(
        // Portalled to <body>: <main> is `relative z-0`, which makes it a
        // stacking context, so every z-index inside it — including this
        // z-[80] — collapses into that one z-0 layer and loses to the z-50
        // bottom nav rendered outside it. Standalone this was masked by the
        // page hiding the nav; embedded in a tab, nothing hides it, and the
        // sheet's last rows sat under a fully-lit navbar that took the tap.
        <div className="fixed inset-0 z-[80] md:hidden" data-testid="concord-channel-sheet">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setChannelSheetOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 flex max-h-[70vh] flex-col rounded-t-2xl border-t border-border/30 bg-background">
            {/* Pinned header: grab handle (tap closes) + explicit ✕, above the scrolling list. */}
            <div className="relative shrink-0 px-3 pt-3">
              <button
                type="button"
                onClick={() => setChannelSheetOpen(false)}
                className="flex w-full items-center justify-center py-2 -mt-2"
                aria-label="Close room list"
                data-testid="concord-channel-sheet-handle"
              >
                <span className="w-9 h-1 rounded-full bg-muted-foreground/20" />
              </button>
              <button
                type="button"
                onClick={() => setChannelSheetOpen(false)}
                className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground active:bg-muted/40 transition-colors"
                aria-label="Close"
                data-testid="concord-channel-sheet-close"
              >
                <X className="w-5 h-5" />
              </button>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 px-2 mb-1.5">Rooms</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(env(safe-area-inset-bottom,0px),0.75rem)]">
              <div className="space-y-0.5">
                {channels.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => { setActiveId(ch.id); setChannelSheetOpen(false); }}
                    className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm text-left transition-colors ${
                      ch.id === activeChannel?.id ? "bg-accent text-accent-foreground dark:bg-brand/15 dark:text-brand font-medium" : "text-foreground/80 active:bg-muted/30"
                    } ${mutedChannels.has(ch.id) ? "opacity-50" : ""}`}
                    data-testid={`concord-channel-${ch.id.slice(0, 8)}`}
                  >
                    {ch.isPrivate ? <Lock className="w-4 h-4 shrink-0 opacity-60" /> : <Hash className="w-4 h-4 shrink-0 opacity-60" />}
                    <span className="truncate flex-1">{ch.name}</span>
                    <ChannelRowSignal
                      muted={mutedChannels.has(ch.id)}
                      mentions={mentionCounts.get(mentionKey(community.community_id, ch.id)) ?? 0}
                      unread={unreadChannels.has(ch.id)}
                      onUnmute={() => setChannelMuted(community.community_id, ch.id, false)}
                      testId={`concord-channel-dot-sheet-${ch.id.slice(0, 8)}`}
                    />
                  </button>
                ))}
              </div>
              {canManageChannels && (
                <button onClick={() => { setChannelSheetOpen(false); setCreateOpen(true); }} className="flex items-center gap-2 w-full px-3 py-2.5 mt-1 rounded-xl text-sm text-brand active:bg-brand/10 transition-colors" data-testid="concord-add-channel-mobile">
                  <Plus className="w-4 h-4" /> New room
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
      {/* Desktop channel header — with one channel the #name chrome is jargon;
          keep just the right-aligned ⋯ menu (settings/members/invite/leave). */}
      {/* `openInvite`, not the prop: gate on the door we will actually offer,
          or a member who may invite computes an item into a row that never
          renders. */}
      {/* `hasAnyCapability` belongs in this gate now that the header carries the
          admin door itself. Without it, an admin holding something OTHER than
          manageChannels — a moderator with manageMembers, say — in a
          single-room community with no overview, invite, leave or member toggle
          would get a Manage button inside a header that never renders. The
          mechanism would exist and nothing would reach it. */}
      {(!single || hasAnyCapability(caps) || canManageChannels || onOverview || openInvite || onLeave || onToggleMembers) && (
      <div className="hidden md:flex items-center gap-2 px-4 py-2.5 border-b border-border/20 shrink-0" data-testid="concord-channel-header">
        {!single && (
          <>
            {activeChannel?.isPrivate ? <Lock className="w-4 h-4 text-muted-foreground/50 shrink-0" /> : <Hash className="w-4 h-4 text-muted-foreground/50 shrink-0" />}
            <span className="text-sm font-semibold truncate">{activeChannel?.name}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          {onToggleMembers && (
            <button
              onClick={onToggleMembers}
              className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                membersCollapsed
                  ? "text-muted-foreground/50 hover:text-foreground hover:bg-muted/40"
                  : "text-brand bg-brand/10 hover:bg-brand/15"
              }`}
              title={membersCollapsed ? "Show members" : "Hide members"}
              aria-label={membersCollapsed ? "Show members" : "Hide members"}
              aria-pressed={!membersCollapsed}
              data-testid="concord-toggle-members"
            >
              <Users className="w-4 h-4" />
            </button>
          )}
          {hasAnyCapability(caps) && (
            <button
              onClick={() => setAdminOpen(true)}
              className="flex items-center gap-1.5 h-7 px-2 rounded-full text-xs font-medium text-brand hover:bg-brand/10 transition-colors"
              data-testid="concord-manage"
            >
              <Shield className="w-3.5 h-3.5" />
              Manage
            </button>
          )}
          <SpaceOverflowMenu
            triggerClassName="flex items-center justify-center w-7 h-7 rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 transition-colors"
            triggerIconClassName="w-4 h-4"
            triggerTestId="concord-channel-settings"
            onManage={undefined}
            onMembers={onOverview}
            onInvite={openInvite}
            onLeave={isOwner ? undefined : onLeave}
            petnameSubject={{ kind: "group", id: community.community_id, realName: community.name }}
            isOwner={isOwner}
            muteContext={{ communityId: community.community_id, channelId: single ? undefined : activeChannel?.id, channelName: activeChannel?.name }}
          />
        </div>
      </div>
      )}
      <ConcordCreateChannelDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        community={community}
        onCommunityChange={onCommunityChange}
        onCreated={setActiveId}
      />
      {/* One admin door, shared with the outpost page so the sections cannot
          drift between the two surfaces. */}
      {/* Only when the host has none: the standalone page owns its own, and two
          live invite dialogs over one community is how their link lists drift. */}
      {!onInvite && canInvite && (
        <ConcordInviteDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          community={community}
          memberPubkeys={rosterPubkeys(community.community_id, govRoster)}
        />
      )}
      <ConcordAdminDrawer
        open={adminOpen}
        onOpenChange={setAdminOpen}
        community={community}
        onCommunityChange={onCommunityChange}
        isOwner={isOwner}
        myMember={myMember}
        govState={govState}
        auditLog={auditLog}
        events={govEvents}
        channels={channels}
        onDissolve={onDissolve}
        onChannelCreated={setActiveId}
      />
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">Delete message?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">This removes it for everyone. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pendingDelete) deleteMessage(pendingDelete); setPendingDelete(null); }} className="text-xs bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Messages */}
      <ConcordChannelNavProvider value={channelNav}>
      {/* overflow-x-hidden is NOT decoration. Setting only `overflow-y: auto`
          computes `overflow-x` to `auto` too, so a single over-wide child turns
          the entire transcript into a horizontal scroller — reported from a
          phone as every message shifted left with the names and timestamps cut
          off. A message list has no business scrolling sideways; anything that
          genuinely needs width scrolls inside itself. */}
      <div ref={scrollRef} onScroll={onMessagesScroll} className="flex-1 overflow-y-auto overflow-x-hidden px-3 md:px-4 py-3">
        {/* Reading-width cap: messages stay scannable next to the sidebar.
            `justify-end` bottom-anchors a short conversation against the
            composer, the way every chat client does — a handful of messages
            used to pin to the TOP and leave the pane's whole height as dead
            air below them. It is a no-op once the timeline overflows (no free
            space left to distribute), so it cannot strand scrollback. */}
        <div className="flex flex-col justify-end gap-3 min-h-full w-full max-w-[46rem] mx-auto">
        {timeline.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center gap-2">
            <Hash className="w-8 h-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/50">No messages yet</p>
            <p className="text-[11px] text-muted-foreground/35">Encrypted end-to-end. Say hello.</p>
            {/* "Say hello" to an empty room is a dead end. This retires itself
                the moment anyone speaks — which is exactly when it stops being
                the thing to do next. */}
            {openInvite && (
              <button
                onClick={openInvite}
                className="mt-1 inline-flex items-center gap-1.5 min-h-[44px] md:min-h-0 md:py-1.5 px-3 rounded-full text-xs font-medium text-brand hover:bg-brand/10 transition-colors"
                data-testid="concord-empty-invite"
              >
                <Link2 className="w-3.5 h-3.5" /> Invite people
              </button>
            )}
          </div>
        ) : timeline.map((item, idx) => {
          const meta = rowMeta[idx];
          // A message directly under the "New" divider always shows its own
          // header — grouping it under the last-read message would orphan it.
          const grouped = meta.grouped && idx !== firstUnreadIdx;
          return (
          <div key={item.kind === "msg" ? item.msg.id : item.id} className={grouped && !meta.dayDivider ? "-mt-2" : undefined}>
          {meta.dayDivider && (
            <div className="flex items-center gap-2 my-1.5 select-none" data-testid="concord-day-divider">
              <div className="flex-1 h-px bg-border/40" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 tabular-nums">{meta.dayDivider}</span>
              <div className="flex-1 h-px bg-border/40" />
            </div>
          )}
          {idx === firstUnreadIdx && (
            <div className="flex items-center gap-2 my-2" data-testid="concord-unread-divider">
              <div className="flex-1 h-px bg-primary/30" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-brand/70">New</span>
              <div className="flex-1 h-px bg-primary/30" />
            </div>
          )}
          {item.kind === "sys" ? (
            <SystemLine pubkey={item.pubkey} action={item.action} />
          ) : (
          <ConcordMessageRow msgId={item.msg.id} pubkey={item.msg.pubkey} content={item.msg.content} media={item.msg.media} mine={item.msg.pubkey === pubkey}
            t={item.msg.t} grouped={grouped}
            edited={item.msg.edited} deleted={item.msg.deleted} mentionedMe={!!pubkey && !!item.msg.mentions?.includes(pubkey)}
            reactions={reactionsByMessage.get(item.msg.id)} myPubkey={pubkey}
            replyTo={item.msg.replyTo} parent={item.msg.replyTo ? messagesById.get(item.msg.replyTo.id) : undefined}
            thread={threading.meta.get(item.msg.id)} onOpenThread={() => openThread(item.msg.id)}
            editing={editingId === item.msg.id}
            onReact={(emoji, url) => toggleReaction({ id: item.msg.id, pubkey: item.msg.pubkey }, emoji, url)}
            onReply={() => setReplyingTo(item.msg)}
            onStartEdit={() => setEditingId(item.msg.id)}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={(text) => saveEdit(item.msg, text)}
            onRequestDelete={() => setPendingDelete(item.msg)} />
          )}
          </div>
          );
        })}
        </div>
      </div>
      </ConcordChannelNavProvider>
      {/* Composer */}
      <div className="border-t border-border/20 shrink-0 relative">
        {/* Jump-to-latest sits ON the composer's top edge (`bottom-full`), not
            at a measured offset from the pane's bottom. It was `bottom-[68px]`
            — the composer's height on one device — and the composer grows with
            a typing line, a reply preview, a staged attachment or the
            home-indicator inset, at which point the pill landed on the
            cancel-reply ✕ and won the tap. */}
        {!atBottom && timeline.length > 0 && (
          <button onClick={jumpToLatest} className="absolute bottom-full right-3 mb-2 z-10 flex items-center gap-1.5 h-8 px-3 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:opacity-90 transition-opacity" data-testid="concord-jump-latest">
            {firstUnreadIdx >= 0 && <span className="tabular-nums">{timeline.length - firstUnreadIdx} new</span>}
            <ChevronDown className="w-4 h-4" />
          </button>
        )}
        {/* mx-auto, matching the message column: the reading-width cap used to
            be left-aligned, so on a pane wider than 46rem the whole
            conversation hugged the left edge with a dead gutter to its right. */}
        <div className="w-full max-w-[46rem] mx-auto">
        {typing.size > 0 && (
          <div className="px-3 pt-1.5 h-5" data-testid="concord-typing"><TypingIndicator pubkeys={[...typing]} /></div>
        )}
        {mentionActive && (
          <div className="absolute bottom-full left-3 right-3 md:max-w-[50rem] mb-1 z-20" data-testid="concord-mention-list">
            <MentionSearch query={mentionQuery} visible={mentionActive} onSelect={handleMentionSelect} onClose={closeMention} position="static" />
          </div>
        )}
        {replyingTo && (
          <div className="flex items-center gap-2 px-3 pt-2.5 text-xs" data-testid="concord-replying-to">
            <div className="w-0.5 self-stretch bg-primary/50 rounded-full" />
            <div className="min-w-0 flex-1">
              <ReplyingToLabel pubkey={replyingTo.pubkey} />
              <p className="text-muted-foreground/60 truncate"><ConcordContentPreview content={replyingTo.content} fallback={replyingTo.media?.length ? "Attachment" : undefined} /></p>
            </div>
            <button onClick={() => setReplyingTo(null)} className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground/50 hover:bg-muted/40" data-testid="concord-cancel-reply"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}
        {(staged || uploading) && (
          <div className="flex items-center gap-2 px-3 pt-2.5">
            {uploading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground/60 rounded-lg border border-border/30 bg-muted/20 px-3 py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Encrypting & uploading…
              </div>
            ) : staged && (
              <div className="relative">
                {staged.mime.startsWith("image/") && !staged.key
                  ? <img src={staged.url} alt="" className="h-16 w-16 object-cover rounded-lg border border-border/30" />
                  : <div className="h-16 px-3 flex items-center rounded-lg border border-border/30 bg-muted/20 text-xs text-muted-foreground/70 max-w-[160px]"><span className="truncate">{staged.name ?? staged.mime}</span></div>}
                <button onClick={() => setStaged(null)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-foreground/80 text-background flex items-center justify-center" data-testid="concord-remove-staged"><X className="w-3 h-3" /></button>
              </div>
            )}
          </div>
        )}
        {/* env(safe-area-inset-bottom) is a VIEWPORT constant — it has no idea
            where this element is. Embedded, the composer ends mid-page and was
            paying ~34px to clear a home indicator hundreds of pixels below it. */}
        <div className={`flex items-center gap-1.5 px-3 pt-2.5 ${embedded ? "pb-2.5" : "pb-[max(env(safe-area-inset-bottom,0px),0.625rem)]"} md:pb-2.5`}>
          <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} data-testid="concord-file-input" />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center justify-center w-11 h-11 md:w-9 md:h-9 shrink-0 rounded-full text-muted-foreground/60 hover:text-brand hover:bg-brand/10 disabled:opacity-40 transition-colors" title="Attach" data-testid="concord-attach">
            <ImagePlus className="w-[18px] h-[18px]" />
          </button>
          <ComposeEmojiPicker hideStickers onInsert={(t) => setDraft((d) => d + t)} onGifSelect={(url) => setStaged({ url, mime: "image/gif" })} />
          <input
            ref={composerRef}
            value={draft}
            onChange={onDraftChange}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!mentionActive) send(); } if (e.key === "Escape") { if (mentionActive) closeMention(); else if (replyingTo) setReplyingTo(null); } }}
            placeholder={replyingTo ? "Write a reply…" : single ? "Message" : `Message #${activeChannel?.name ?? ""}`}
            // min-w-0, or this row cannot shrink at all: an <input> keeps
            // min-width:auto — an intrinsic ~20-character floor — so `flex-1`
            // never gets to give anything back. On a 350px phone that pushed
            // Send 21px past the content box (clipped by the panel) and crushed
            // the only shrinkable sibling, the emoji trigger, from 32px to 18.
            className="flex-1 min-w-0 h-11 md:h-10 px-3 rounded-full bg-muted/20 border border-border/30 text-base md:text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
            data-testid="concord-composer"
          />
          <button onClick={send} disabled={(!draft.trim() && !staged) || sending} className="flex items-center justify-center w-11 h-11 md:w-10 md:h-10 shrink-0 rounded-full bg-primary text-primary-foreground disabled:opacity-40 transition-opacity" data-testid="concord-send">
            <Send className="w-4 h-4" />
          </button>
        </div>
        </div>{/* /composer width cap */}
      </div>
      </div>{/* /message pane */}

      {/* Thread panel — a right column on desktop (standing in for Members), a
          full-screen layer on mobile. Read-only: replying hands the root back
          to the channel composer, so there is one send path, not two. */}
      {threadRoot && (
        <ConcordThreadPanel
          embedded={embedded}
          root={threadRoot}
          replies={threading.threads.get(threadRoot.id) ?? []}
          myPubkey={pubkey}
          reactionsByMessage={reactionsByMessage}
          messagesById={messagesById}
          editingId={editingId}
          onClose={closeThread}
          onReply={() => { setReplyingTo(threadRoot); closeThread(); composerRef.current?.focus(); }}
          onReact={(m, emoji, url) => toggleReaction({ id: m.id, pubkey: m.pubkey }, emoji, url)}
          onStartEdit={setEditingId}
          onSaveEdit={saveEdit}
          onRequestDelete={setPendingDelete}
        />
      )}
    </div>
  );
}

/**
 * One thread: its starter, then every reply, oldest first. Deliberately a VIEW —
 * it reuses the channel's message row (so reactions, edit, delete and media all
 * behave identically) and routes "Reply" back through the channel composer with
 * the starter armed, which is what keeps a reply landing in THIS thread.
 */
function ConcordThreadPanel({ root, replies, myPubkey, reactionsByMessage, messagesById, editingId, embedded, onClose, onReply, onReact, onStartEdit, onSaveEdit, onRequestDelete }: {
  root: ChatMsg;
  /** See ConcordChat's own `embedded`: this panel is `absolute inset-0` over the
   *  chat's box, so embedded its bottom edge is the panel's, not the screen's. */
  embedded?: boolean;
  replies: ChatMsg[];
  myPubkey?: string | null;
  reactionsByMessage: Map<string, Map<string, ReactionAgg>>;
  messagesById: Map<string, ChatMsg>;
  editingId: string | null;
  onClose: () => void;
  onReply: () => void;
  onReact: (msg: ChatMsg, emoji: string, emojiUrl?: string) => void;
  onStartEdit: (id: string | null) => void;
  onSaveEdit: (msg: ChatMsg, text: string) => void;
  onRequestDelete: (msg: ChatMsg) => void;
}) {
  const row = (m: ChatMsg) => (
    <ConcordMessageRow
      msgId={m.id} pubkey={m.pubkey} content={m.content} media={m.media} mine={m.pubkey === myPubkey}
      t={m.t} edited={m.edited} deleted={m.deleted} mentionedMe={!!myPubkey && !!m.mentions?.includes(myPubkey)}
      reactions={reactionsByMessage.get(m.id)} myPubkey={myPubkey}
      replyTo={m.replyTo} parent={m.replyTo ? messagesById.get(m.replyTo.id) : undefined}
      editing={editingId === m.id}
      onReact={(emoji, url) => onReact(m, emoji, url)}
      onReply={onReply}
      onStartEdit={() => onStartEdit(m.id)}
      onCancelEdit={() => onStartEdit(null)}
      onSaveEdit={(text) => onSaveEdit(m, text)}
      onRequestDelete={() => onRequestDelete(m)}
    />
  );
  return (
    <aside
      className="absolute inset-0 z-20 flex flex-col bg-background md:static md:z-auto md:w-[21rem] md:shrink-0 md:border-l md:border-border/20"
      data-testid="concord-thread-panel"
    >
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/20 shrink-0">
        <MessageSquare className="w-4 h-4 text-muted-foreground/50 shrink-0" />
        <span className="text-sm font-medium flex-1 min-w-0 truncate">Thread</span>
        <span className="text-[11px] text-muted-foreground/50 tabular-nums shrink-0">{replies.length === 1 ? "1 reply" : `${replies.length} replies`}</span>
        <button onClick={onClose} className="flex items-center justify-center w-9 h-9 md:w-7 md:h-7 shrink-0 rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-muted/40 transition-colors" aria-label="Close thread" data-testid="concord-thread-close">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 flex flex-col gap-3">
        {row(root)}
        <div className="flex items-center gap-2 select-none">
          <div className="flex-1 h-px bg-border/40" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">{replies.length === 1 ? "1 reply" : `${replies.length} replies`}</span>
          <div className="flex-1 h-px bg-border/40" />
        </div>
        {replies.map((m) => <div key={m.id}>{row(m)}</div>)}
      </div>
      <div className={`border-t border-border/20 shrink-0 p-2.5 ${embedded ? "pb-2.5" : "pb-[max(env(safe-area-inset-bottom,0px),0.625rem)]"} md:pb-2.5`}>
        <button onClick={onReply} className="flex items-center justify-center gap-1.5 w-full h-10 rounded-full bg-brand/10 text-brand text-xs font-medium hover:bg-brand/15 transition-colors" data-testid="concord-thread-reply">
          <CornerUpLeft className="w-3.5 h-3.5" /> Reply to thread
        </button>
      </div>
    </aside>
  );
}

/**
 * Trailing signal for one channel-switcher row, three-tier + calm:
 *  - muted   → slash-bell glyph (tap = unmute; the row itself is dimmed).
 *              Rendered as a span with role="button" — rows are <button>s and
 *              buttons can't nest.
 *  - mentions → small violet COUNT badge (the only place numbers come from).
 *  - unread  → the existing plain activity dot, never a number.
 */
function ChannelRowSignal({ muted, mentions, unread, onUnmute, testId }: {
  muted: boolean;
  mentions: number;
  unread: boolean;
  onUnmute: () => void;
  testId: string;
}) {
  if (muted) {
    return (
      <span
        role="button"
        tabIndex={0}
        title="Muted — tap to unmute"
        aria-label="Muted room — unmute"
        onClick={(e) => { e.stopPropagation(); onUnmute(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onUnmute(); } }}
        className="flex items-center justify-center w-5 h-5 -mr-1 rounded shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors"
        data-testid={`${testId}-muted`}
      >
        <BellOff className="w-3.5 h-3.5" />
      </span>
    );
  }
  if (mentions > 0) {
    return (
      <span
        className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shrink-0"
        aria-label={`${mentions} mention${mentions === 1 ? "" : "s"}`}
        data-testid={`${testId}-mentions`}
      >
        {mentions > 9 ? "9+" : mentions}
      </span>
    );
  }
  if (unread) {
    return (
      <span className="w-2 h-2 rounded-full bg-primary shrink-0 shadow-[0_0_6px_rgba(139,92,246,0.6)]" aria-label="Unread messages" data-testid={testId} />
    );
  }
  return null;
}

/**
 * The chat header's ⋯ menu (was a direct jump into the rename dialog): Channel
 * settings, Members, Invite, Mute (channel + whole group), and Leave/Delete —
 * every item reuses an existing dialog/flow via the callbacks. Items the
 * viewer can't use are absent; when nothing is available the trigger hides
 * entirely. Mute is available to every member (muteContext), so the trigger
 * shows even in the relay-outpost ChatTab, which passes no other callbacks.
 */

/** "Replying to <name>" label — resolves the target's profile name. */
function ReplyingToLabel({ pubkey }: { pubkey: string }) {
  const { name } = useConcordProfile(pubkey);
  return <p className="font-medium text-brand/70">Replying to {name}</p>;
}

/** A single name for the typing line. */
function TypingName({ pubkey }: { pubkey: string }) {
  const { name } = useConcordProfile(pubkey);
  return <span className="font-medium">{name}</span>;
}

/** "X is typing…" — one name, or "Several people are typing…" for many. */
function TypingIndicator({ pubkeys }: { pubkeys: string[] }) {
  return (
    <p className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
      {pubkeys.length === 1 ? <><TypingName pubkey={pubkeys[0]} /> is typing…</> : "Several people are typing…"}
    </p>
  );
}

/** Subtle centered system line — WhatsApp/Signal style. Joins/leaves plus the
 *  neutral moderation outcomes; copy stays minimal and NEVER carries a reason
 *  (reasons are admin-only, in the audit log). */
function SystemLine({ pubkey, action }: { pubkey: string; action: SystemAction }) {
  const { name } = useConcordProfile(pubkey);
  const suffix =
    action === "join" ? "joined"
    : action === "leave" ? "left"
    : action === "kick" ? "was removed by an admin"
    : "was banned by an admin";
  return (
    <div className="flex justify-center my-1" data-testid="concord-system-line">
      <span className="text-[11px] text-muted-foreground/45">
        <span className="font-medium text-muted-foreground/60">{name}</span> {suffix}
      </span>
    </div>
  );
}

/** A compact quote of the parent message shown above a reply. npub/nprofile
 *  tokens resolve to @DisplayName (instead of being stripped as bech32 noise);
 *  note/naddr refs collapse to "Shared a post" via ConcordContentPreview. */
function QuotedParent({ parent, replyPubkey }: { parent?: ChatMsg; replyPubkey: string }) {
  const { name } = useConcordProfile(parent?.pubkey ?? replyPubkey);
  return (
    <div className="flex items-center gap-1.5 mb-0.5 text-[11px] text-muted-foreground/60 min-w-0">
      <CornerUpLeft className="w-3 h-3 shrink-0 text-muted-foreground/40" />
      {/* Capped, not shrink-0: a long unbroken display name is another thing
          that can push this row past the screen, and the reply line is the one
          place a name is context rather than content. */}
      <span className="font-medium text-foreground/60 shrink-0 max-w-[45%] truncate">{name}</span>
      <span className="truncate">
        {parent
          ? <ConcordContentPreview content={parent.content} fallback={parent.media?.length ? "Attachment" : undefined} />
          : "message"}
      </span>
    </div>
  );
}

/** One message row: real avatar + display name, media, reactions, reply, edit/delete. */
/** Up to three overlapping repliers — who's talking, before you tap in. */
function ThreadFacepile({ pubkeys }: { pubkeys: string[] }) {
  const shown = pubkeys.slice(0, 3);
  return (
    <span className="flex -space-x-1.5 shrink-0">
      {shown.map((pk) => <ThreadFace key={pk} pubkey={pk} />)}
    </span>
  );
}

function ThreadFace({ pubkey }: { pubkey: string }) {
  const { name, avatar } = useConcordProfile(pubkey);
  return (
    <Avatar className="w-5 h-5 border border-background">
      {avatar && <AvatarImage src={avatar} alt="" />}
      <AvatarFallback className="text-[8px] bg-brand/10 text-brand font-semibold">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

function ConcordMessageRow({ msgId, pubkey, content, media, mine, t, grouped, edited, deleted, mentionedMe, reactions, myPubkey, replyTo, parent, thread, onOpenThread, editing, onReact, onReply, onStartEdit, onCancelEdit, onSaveEdit, onRequestDelete }: {
  msgId: string; pubkey: string; content: string; media?: ConcordMedia[]; mine: boolean; t?: number; grouped?: boolean; edited?: boolean; deleted?: boolean; mentionedMe?: boolean;
  reactions?: Map<string, ReactionAgg>; myPubkey?: string | null;
  replyTo?: { id: string; pubkey: string }; parent?: ChatMsg; editing: boolean;
  /** Set when replies hang off this message — renders the thread chip. */
  thread?: ThreadMeta; onOpenThread?: () => void;
  onReact: (emoji: string, emojiUrl?: string) => void; onReply: () => void;
  onStartEdit: () => void; onCancelEdit: () => void; onSaveEdit: (text: string) => void; onRequestDelete: () => void;
}) {
  const { name, avatar, hasProfile } = useConcordProfile(pubkey);
  // Member identity is a real Nostr pubkey, so the avatar/name open the profile
  // and (on desktop) surface the same rich hover card as an @-mention — turning a
  // group chat into a place to discover and connect with people.
  const authorNpub = useMemo(() => { try { return nip19.npubEncode(pubkey); } catch { return ""; } }, [pubkey]);
  const [editText, setEditText] = useState(content);
  useEffect(() => { if (editing) setEditText(content); }, [editing, content]);
  const chips = reactions ? [...reactions.values()].filter((a) => a.reactors.size > 0) : [];
  const showTime = typeof t === "number";
  return (
    <div className={`flex items-start gap-2.5 group relative rounded-lg ${mentionedMe && !deleted ? "bg-primary/[0.06] border-l-2 border-primary/50 -ml-0.5 pl-2 py-0.5" : ""}`} data-testid="concord-message">
      {grouped ? (
        // Grouped under the same author: the avatar slot becomes a hover-reveal
        // timestamp gutter (Discord/Slack), so the row stays anchored to the
        // avatar column but reads as one continued turn.
        <div className="w-7 shrink-0 flex justify-end pt-0.5" aria-hidden={!showTime}>
          {showTime && (
            <span className="text-[9px] leading-none tabular-nums text-transparent group-hover:text-muted-foreground/45 transition-colors" data-testid="concord-message-time-grouped">{chatClockTime(t!)}</span>
          )}
        </div>
      ) : (
        <AuthorHoverCard pubkey={pubkey}>
          <Link href={authorNpub ? `/profile/${authorNpub}` : "#"} onClick={(e: React.MouseEvent) => e.stopPropagation()} className="shrink-0" aria-label={`View ${name}'s profile`}>
            <Avatar className="w-7 h-7 shrink-0 border border-border/30 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-shadow">
              {avatar && <AvatarImage src={avatar} alt={name} />}
              <AvatarFallback className="text-[10px] bg-brand/10 text-brand font-semibold">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Link>
        </AuthorHoverCard>
      )}
      <div className="min-w-0 flex-1">
        {replyTo && <QuotedParent parent={parent} replyPubkey={replyTo.pubkey} />}
        {/* Group header: sender name + a subtle absolute time. Slack-style
            deterministic sender hue for OTHER members' resolved names (shared
            curated AA palette — lib/sender-color.ts); your own name and raw-npub
            fallbacks stay neutral. Grouped rows omit the header entirely. */}
        {!grouped && (
        <div className="flex items-baseline gap-1.5">
          <AuthorHoverCard pubkey={pubkey}>
            <Link href={authorNpub ? `/profile/${authorNpub}` : "#"} onClick={(e: React.MouseEvent) => e.stopPropagation()} className="min-w-0 no-underline">
              <span
                className={`text-xs font-semibold truncate cursor-pointer hover:underline underline-offset-2 ${!mine && hasProfile ? "" : "text-foreground/90"}`}
                style={!mine && hasProfile ? { color: senderColor(pubkey) } : undefined}
              >{name}</span>
            </Link>
          </AuthorHoverCard>
          {mine && <span className="text-[9px] text-brand/60 font-normal shrink-0">you</span>}
          {showTime && <time className="text-[10px] font-normal text-muted-foreground/40 tabular-nums shrink-0" data-testid="concord-message-time">{chatClockTime(t!)}</time>}
        </div>
        )}
        {deleted ? (
          <p className="text-sm italic text-muted-foreground/40">This message was deleted</p>
        ) : editing ? (
          <div className="flex items-center gap-1.5 mt-0.5">
            <input autoFocus value={editText} onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSaveEdit(editText); if (e.key === "Escape") onCancelEdit(); }}
              className="flex-1 h-8 px-2.5 rounded-lg bg-muted/20 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" data-testid="concord-edit-input" />
            <button onClick={() => onSaveEdit(editText)} className="text-[11px] text-brand hover:underline" data-testid="concord-edit-save">Save</button>
            <button onClick={onCancelEdit} className="text-[11px] text-muted-foreground/60 hover:underline">Cancel</button>
          </div>
        ) : (
          <>
            {/* div (not p): resolved note/naddr refs render block-level cards,
                which are invalid inside <p> (same rule as the feed renderer). */}
            {/* break-words is not enough on its own: `overflow-wrap: break-word`
                is explicitly ignored when the browser computes min-content
                width, so a long unbroken token (a nevent1…, a .xdc URL, a hash)
                still sets this row's minimum and pushes it wider than the
                screen. `anywhere` is the value that counts toward intrinsic
                sizing, which is what actually stops the overflow. */}
            {content && <div className="post-content-text reply-content-text break-words [overflow-wrap:anywhere] whitespace-pre-wrap"><ConcordMessageBody id={msgId} pubkey={pubkey} content={content} />{edited && <span className="ml-1 text-[10px] text-muted-foreground/40">(edited)</span>}</div>}
            {media && media.length > 0 && (
              <div className="flex flex-col gap-1.5 mt-1.5">
                {media.map((m, i) => <ConcordMediaView key={i} media={m} />)}
              </div>
            )}
          </>
        )}
        {thread && thread.count > 0 && onOpenThread && (
          <button
            onClick={onOpenThread}
            className="flex items-center gap-1.5 mt-1.5 h-7 pl-1 pr-2.5 rounded-full text-[11px] font-medium text-brand hover:bg-brand/10 transition-colors"
            data-testid="concord-thread-chip"
          >
            <ThreadFacepile pubkeys={thread.repliers} />
            <span>{thread.count === 1 ? "1 reply" : `${thread.count} replies`}</span>
          </button>
        )}
        {!deleted && chips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {chips.map((a) => (
              <ConcordReactionPill
                key={a.emoji}
                emoji={a.emoji}
                emojiUrl={a.emojiUrl}
                reactors={[...a.reactors]}
                reacted={!!myPubkey && a.reactors.has(myPubkey)}
                onReact={() => onReact(a.emoji, a.emojiUrl)}
                myPubkey={myPubkey}
              />
            ))}
          </div>
        )}
      </div>
      {/* One Signal-style actions menu — hover on desktop, always subtle on mobile */}
      {!deleted && !editing && (
        <div className="shrink-0 self-start opacity-60 reveal-on-hover">
          <ConcordMessageActions content={content} mine={mine} onReact={onReact} onReply={onReply} onEdit={onStartEdit} onDelete={onRequestDelete} />
        </div>
      )}
    </div>
  );
}
