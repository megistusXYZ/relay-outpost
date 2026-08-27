import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { notifyNeedsYouChanged } from "@/contexts/NeedsYouContext";
import type { Event as NostrEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { Link } from "wouter";
import { pool, fetchProfilesCached, eventStore, subscriptionAuthFor } from "@/lib/nostr";
import { getPinnedRooms, setPinnedRooms } from "@/lib/room-pins";
import { nip29Capabilities, hasAnyCapability } from "@/lib/space-admin";
import { insertSorted } from "@/lib/message-list";
import { senderColor } from "@/lib/sender-color";
import { buildChatRenderItems, type ChatSystemEvent, type ChatRenderItem } from "@/lib/chat-render-items";
import { withSignerTimeout, SIGNER_SIGN_TIMEOUT } from "@/lib/signer-timeout";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { getSignalTierLabel } from "@/lib/graperank";
import { TrustTierGlyph } from "@/components/nostr-post/trust-tier-glyph";
import { useToast } from "@/hooks/use-toast";
import { useKeyboardViewport } from "@/hooks/use-keyboard-viewport";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { AddMemberSheet } from "@/components/AddMemberSheet";
import { SpaceOverflowMenu } from "@/components/space/SpaceOverflowMenu";
import { Nip29AdminDrawer } from "@/components/space/Nip29AdminDrawer";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { useSidebar } from "@/components/ui/sidebar";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveFormPanel } from "@/components/ui/responsive-form-panel";
import { CreateChannelWizard, type CreateChannelOpts } from "@/components/CreateChannelWizard";
import {
  MessageSquare,
  Lock,
  Send,
  ArrowLeft,
  LogIn,
  LogOut,
  Trash2,
  UserMinus,
  Reply,
  X,
  Eye,
  Shield,
  Hash,
  Smile,
  ImagePlus,
  Search,
  Star,
  ChevronDown,
  Clock,
  Plus,
  Globe,
  LockKeyhole,
  Users,
  UserPlus,
  Copy,
  Check,
  Ticket,
  AlertCircle,
  Settings,
  Link2,
  Pin, WifiOff, RefreshCw } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { joinDoor, readDoor } from "@/lib/nip29-door";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { uploadMedia } from "@/lib/media-upload";
import { use$, useRenderedContent, type ComponentMap } from "applesauce-react/hooks";
import { PersonBadges } from "@/components/PersonBadges";
import {
  getAvatarUrl,
  getDisplayName,
  getProfileContent,
  KIND_METADATA,
  formatNpub,
  shortenNpub } from "@/lib/nostr-helpers";
import {
  fetchGroupMetadata,
  fetchGroupMetadataResult,
  fetchSingleGroupMetadata,
  fetchGroupAdminsResult,
  mayHostNip29,
  fetchGroupMembersResult,
  fetchJoinRequests,
  fetchLastActivityBatch,
  sendGroupChat,
  sendJoinRequest,
  sendLeaveRequest,
  sendDeleteEvent,
  sendRemoveUser,
  sendGroupPin,
  sendPutUser,
  deriveGroupId,
  sendCreateGroup,
  sendEditMetadata,
  sendEditAccess,
  sendCreateInvite,
  sendDeleteGroup,
  buildChannelInviteLink,
  parseGroupMessage,
  publishToGroupRelay,
  fetchSimpleGroupsList,
  loadSimpleGroupsBase,
  publishSimpleGroupsList,
  KIND_GROUP_CHAT,
  KIND_GROUP_DELETE_EVENT,
  KIND_GROUP_REMOVE_USER,
  KIND_GROUP_PUT_USER,
  KIND_GROUP_JOIN_REQUEST,
  type GroupMetadata,
  type GroupAdmin,
  type GroupMessage,
  type JoinRequest,
  type SimpleGroupEntry } from "@/lib/nip29";
import { sendDM } from "@/lib/dm";
import { readChannelLastRead, writeChannelLastRead } from "@/lib/room-read";
import { joinOutpostWithEnrichment } from "@/lib/outpost-relays";
import { ProfileSearchInput, type SelectedRecipient } from "@/components/ProfileSearchInput";

// Channels the current user created — lets the creator manage a channel even
// before the relay's kind-39001 admin list propagates. Keyed per relay+group.
const CREATED_GROUPS_KEY = "relay-outpost-created-groups";
function createdGroupKey(relayUrl: string, groupId: string): string {
  return `${relayUrl.replace(/\/+$/, "").toLowerCase()}::${groupId}`;
}
function loadCreatedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(CREATED_GROUPS_KEY);
    return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
  } catch { return new Set<string>(); }
}
function markGroupCreated(relayUrl: string, groupId: string) {
  try {
    const s = loadCreatedGroups();
    s.add(createdGroupKey(relayUrl, groupId));
    localStorage.setItem(CREATED_GROUPS_KEY, JSON.stringify(Array.from(s)));
  } catch {}
}
import { contentComponents, getEventEmojiMap, emojifyChildren, MentionProfileLink, EmbeddedNote, getReactionDisplay } from "@/components/NostrPost";
import { isCustomEmoji, getCustomEmojiShortcode, useCustomEmojis, type CustomEmoji } from "@/hooks/use-custom-emojis";
import { MediaRenderer } from "@/components/MediaRenderer";
import { formatDistanceToNow } from "date-fns";

/**
 * Every live subscription this room opens against its own relay.
 *
 * A community relay is the most likely relay in the app to (a) require NIP-42
 * to read and (b) be slow, and BOTH break a raw pool.subscribeMany:
 *
 *  - without `onauth`, nostr-tools cannot answer a `CLOSED auth-required` by
 *    authenticating and re-issuing the REQ, and since handleClose fires
 *    handleEose first the refusal arrives as a clean end-of-stream
 *  - without `maxWait`, nostr-tools FABRICATES an EOSE at 4400ms through that
 *    same callback, so any relay slower than 4.4s reads as a room with no
 *    messages, no members and no names
 *
 * The room list loaded and the conversations did not, which is exactly those
 * two defects surviving in the per-room subscriptions after the listing was
 * fixed (#583). One helper, so the next subscription added here cannot forget.
 */
function subscribeToRoomRelay(
  relayUrl: string,
  filter: Record<string, unknown>,
  handlers: Record<string, unknown>,
): { close(): void } {
  return pool.subscribeMany([relayUrl], filter as any, {
    ...handlers,
    onauth: subscriptionAuthFor(relayUrl),
    maxWait: 20_000,
  } as any);
}


const chatContentCacheKey = Symbol.for("chat-content-v1");

const chatContentComponents: ComponentMap = {
  ...contentComponents,
  mention: ({ node }) => {
    if (node.decoded.type === "npub" || node.decoded.type === "nprofile") {
      const pubkey = node.decoded.type === "npub" ? node.decoded.data : node.decoded.data.pubkey;
      return <MentionProfileLink pubkey={pubkey} />;
    }
    if (node.decoded.type === "note" || node.decoded.type === "nevent") {
      const eventId = node.decoded.type === "note" ? node.decoded.data : node.decoded.data.id;
      const relays = node.decoded.type === "nevent" ? node.decoded.data.relays : undefined;
      return (
        <div className="max-w-sm">
          <EmbeddedNote eventId={eventId} encoded={node.encoded} relays={relays} />
        </div>
      );
    }
    if (node.decoded.type === "naddr") {
      return (
        <a
          href={`https://njump.me/${node.encoded}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[0.85em] bg-brand/10 border border-brand/20 text-brand hover:bg-brand/20 transition-colors no-underline cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          Referenced article
        </a>
      );
    }
    return <span className="text-brand/90">{node.encoded.slice(0, 16)}...</span>;
  } };

function ChatContentRenderer({ content, tags, eventId, pubkey }: { content: string; tags: string[][]; eventId: string; pubkey: string }) {
  const pseudoEvent = useMemo((): NostrEvent => ({
    id: eventId,
    pubkey: pubkey,
    created_at: 0,
    kind: 9,
    tags: tags || [],
    content: content,
    sig: "" }), [content, tags, eventId, pubkey]);

  const rawRenderedContent = useRenderedContent(pseudoEvent, chatContentComponents, {
    cacheKey: chatContentCacheKey });

  const eventEmojiMap = useMemo(() => getEventEmojiMap(pseudoEvent), [pseudoEvent]);
  const renderedContent = useMemo(() => {
    if (!rawRenderedContent || !eventEmojiMap) return rawRenderedContent;
    return emojifyChildren(rawRenderedContent, eventEmojiMap);
  }, [rawRenderedContent, eventEmojiMap]);

  return (
    <>
      {renderedContent && (
        <div className="text-xs leading-relaxed break-words whitespace-pre-wrap">
          {renderedContent}
        </div>
      )}
      {/* Definite width so chat media renders at a standard size (X/Signal-style)
          instead of collapsing to a short caption's width. empty:hidden keeps
          text-only messages from getting a phantom 320px box. */}
      <div className="w-[min(320px,70vw)] max-w-full mt-1.5 empty:hidden empty:mt-0">
        <MediaRenderer event={pseudoEvent} compact />
      </div>
    </>
  );
}

/**
 * The web-of-trust glyph on a room's people.
 *
 * Carries the SAME three guards as TrustTierDot (author-hover.tsx:78) and for
 * the same reason — it was missing two of them, on the surface decision 9a was
 * written to protect.
 *
 * `getAuthorTier` returns "none" for two unrelated things: this pubkey has no
 * score, and this pubkey has not been looked up yet. `getSignalTierLabel` maps
 * "none" to the word **"Unverified"**. So a room you have just walked into —
 * where nobody is in your `fetchConnectionScores` payload and every member
 * needs an individual round trip — rendered a hollow grey ring labelled with an
 * accusation beside almost everyone in it.
 *
 * That is an absence of data presented as a finding, which is exactly what
 * decision 9b forbids: only ever render affirmative evidence, absence renders
 * nothing. The one exception is `flagged`, which IS a real finding and so
 * survives a missing score.
 */
function WotDot({ pubkey }: { pubkey: string }) {
  const { getAuthorTier, isAuthorFlagged, requestScore, scores, wotEnabled, wotReady } = useGrapeRankScores();
  const tier = getAuthorTier(pubkey);

  useEffect(() => {
    if (tier === "none") requestScore(pubkey);
  }, [pubkey, tier, requestScore]);

  // Off, or this observer's FIRST calculation still running — a new user waits
  // 15–25 minutes for it, and anything drawn before then is a false signal.
  if (!wotEnabled || !wotReady || !scores) return null;

  const flagged = isAuthorFlagged(pubkey);
  // Nothing looked up yet ⇒ say nothing. A flag is a finding and still shows.
  if (!scores.has(pubkey) && !flagged) return null;

  const effectiveTier = flagged ? "flagged" as const : tier;

  return <TrustTierGlyph tier={effectiveTier} size="w-2 h-2" title={getSignalTierLabel(effectiveTier)} />;
}

function ChatAuthorLine({ pubkey, createdAt }: { pubkey: string; createdAt: number }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  const name = profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey));
  const avatar = profile ? getAvatarUrl(profile) : undefined;
  const content = profile ? getProfileContent(profile) : undefined;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <Avatar className="w-6 h-6 shrink-0">
        {avatar && <AvatarImage src={avatar} alt={name} />}
        <AvatarFallback className="text-[8px] bg-brand/10 text-brand">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-[11px] font-medium text-foreground/80 truncate">{name}</span>
      {/* Two different axes, deliberately side by side: PersonBadges is
          domain-attested (NIP-05) plus impersonation collision; WotDot is
          web-of-trust. Same pairing Communities.tsx:501-510 already uses. The
          badge is the AFFIRMATIVE half decision 9b asks for — the fake is
          caught by contrast with a real check, never by an accusation. */}
      <PersonBadges pubkey={pubkey} nip05={content?.nip05} claimedName={content?.display_name || content?.name} showCollision={!!profile} />
      <WotDot pubkey={pubkey} />
      <span className="text-[9px] text-muted-foreground/40 shrink-0">
        {formatDistanceToNow(createdAt * 1000, { addSuffix: true })}
      </span>
    </div>
  );
}

function JoinRequestRow({
  req,
  onApprove,
  onDismiss,
  approving }: {
  req: JoinRequest;
  onApprove: (pubkey: string) => void;
  onDismiss: (pubkey: string) => void;
  approving: boolean;
}) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, req.pubkey), [req.pubkey]);
  const name = profile ? getDisplayName(profile) : shortenNpub(formatNpub(req.pubkey));
  const avatar = profile ? getAvatarUrl(profile) : undefined;
  const content = profile ? getProfileContent(profile) : undefined;

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/20 transition-colors">
      <Avatar className="w-8 h-8 shrink-0">
        {avatar && <AvatarImage src={avatar} alt={name} />}
        <AvatarFallback className="text-[9px] bg-brand/10 text-brand">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground/80 truncate">{name}</span>
          {/* The doorman moment. This row is the single most valuable place in
              the app for affirmative identity evidence — it is the one screen
              where someone is deciding whether a stranger is who they claim. */}
          <PersonBadges pubkey={req.pubkey} nip05={content?.nip05} claimedName={content?.display_name || content?.name} showCollision={!!profile} />
          <WotDot pubkey={req.pubkey} />
        </div>
        <span className="text-[9px] text-muted-foreground/30 font-mono truncate block">
          {shortenNpub(formatNpub(req.pubkey))}
        </span>
        <span className="text-[9px] text-muted-foreground/40">
          {formatDistanceToNow(req.createdAt * 1000, { addSuffix: true })}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onApprove(req.pubkey)}
          disabled={approving}
          className="h-6 text-[10px] text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 gap-0.5 px-2"
        >
          {approving ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <Check className="w-3 h-3" />}
          Let in
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDismiss(req.pubkey)}
          className="h-6 text-[10px] text-muted-foreground/50 hover:text-red-500 gap-0.5 px-1.5"
          aria-label="Dismiss this request"
          title="Dismiss"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

function MemberRow({
  memberPubkey,
  isAdmin,
  canRemove,
  onRemove }: {
  memberPubkey: string;
  isAdmin: boolean;
  canRemove: boolean;
  onRemove?: (pubkey: string) => void;
}) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, memberPubkey), [memberPubkey]);
  useEffect(() => { if (!profile) fetchProfilesCached([memberPubkey]); }, [profile, memberPubkey]);
  const name = profile ? getDisplayName(profile) : shortenNpub(formatNpub(memberPubkey));
  const avatar = profile ? getAvatarUrl(profile) : undefined;
  const content = profile ? getProfileContent(profile) : undefined;
  const npub = useMemo(() => nip19.npubEncode(memberPubkey), [memberPubkey]);

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/20 transition-colors">
      <Link
        href={`/profile/${npub}`}
        className="flex items-center gap-2 flex-1 min-w-0 min-h-[44px] no-underline rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        data-testid={`member-profile-link-${memberPubkey.slice(0, 12)}`}
        aria-label={`View ${name}'s profile`}
      >
        <Avatar className="w-7 h-7 shrink-0">
          {avatar && <AvatarImage src={avatar} alt={name} />}
          <AvatarFallback className="text-[8px] bg-brand/10 text-brand">
            {name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-foreground/80 truncate">{name}</span>
            <PersonBadges pubkey={memberPubkey} nip05={content?.nip05} claimedName={content?.display_name || content?.name} showCollision={!!profile} />
            <WotDot pubkey={memberPubkey} />
            {isAdmin && (
              <span className="text-[8px] text-brand/60 flex items-center gap-0.5">
                <Shield className="w-2.5 h-2.5" />
                Admin
              </span>
            )}
          </div>
        </div>
      </Link>
      {canRemove && onRemove && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRemove(memberPubkey)}
          className="h-6 text-[10px] text-muted-foreground/40 hover:text-red-500 gap-0.5 px-1.5"
        >
          <UserMinus className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}

const REACTION_EMOJIS = ["👍", "❤️", "😂", "🔥", "⚡", "🤙"];
const COMPOSE_EMOJIS = ["😀", "😂", "😍", "🤔", "😎", "🙏", "👍", "❤️", "🔥", "⚡", "🤙", "💯", "🎉", "😢", "😡", "🤣", "💪", "👀", "🫡", "✅"];

// Per-channel last-read timestamps (unread divider + channel unread dots) now
// live in lib/room-read.ts, shared with the Chats list's room rows.

function ReplyPreviewAuthor({ pubkey }: { pubkey?: string }) {
  const profile = use$(() => pubkey ? eventStore.replaceable(KIND_METADATA, pubkey) : undefined, [pubkey]);
  const name = pubkey ? (profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey))) : null;
  return (
    <span className="text-[9px] font-medium text-brand/70 flex items-center gap-1">
      <Reply className="w-2.5 h-2.5 shrink-0" />
      {name || "Unknown"}
    </span>
  );
}

// One resolved member name for a membership summary. Resolves live and falls
// back to a neutral short npub (never a raw red npub) while the profile loads.
function GroupMemberName({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  useEffect(() => { if (!profile) fetchProfilesCached([pubkey]); }, [profile, pubkey]);
  const name = profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey));
  return <span className="font-medium text-muted-foreground/70">{name}</span>;
}

// "Alice joined", "Alice and Bob joined", "Alice, Bob and Carol joined",
// "Alice, Bob and 4 others joined".
function MembershipPhrase({ pubkeys, verb }: { pubkeys: string[]; verb: "joined" | "left" }) {
  const n = pubkeys.length;
  if (n === 0) return null;
  if (n > 3) {
    return (
      <>
        <GroupMemberName pubkey={pubkeys[0]} />
        {", "}
        <GroupMemberName pubkey={pubkeys[1]} />
        {` and ${n - 2} others ${verb}`}
      </>
    );
  }
  return (
    <>
      {pubkeys.map((pk, i) => (
        <span key={pk}>
          {i > 0 && (i === n - 1 ? " and " : ", ")}
          <GroupMemberName pubkey={pk} />
        </span>
      ))}
      {` ${verb}`}
    </>
  );
}

// A run of membership churn collapsed into ONE quiet, centered line —
// de-emphasized vs real messages. No-op join+leave pairs are already dropped
// upstream in summarizeSystemRun.
function ChatSystemGroupLine({ joins, leaves }: { joins: string[]; leaves: string[] }) {
  if (joins.length === 0 && leaves.length === 0) return null;
  return (
    <div className="flex items-center justify-center my-1.5 px-6" data-testid="chat-system-group">
      <span className="text-[10px] leading-snug text-center text-muted-foreground/45">
        {joins.length > 0 && <MembershipPhrase pubkeys={joins} verb="joined" />}
        {joins.length > 0 && leaves.length > 0 && <span className="mx-1 text-muted-foreground/30">·</span>}
        {leaves.length > 0 && <MembershipPhrase pubkeys={leaves} verb="left" />}
      </span>
    </div>
  );
}

function ReactionTooltipName({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  return <>{profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey))}</>;
}

function ReactionTooltipNames({ pubkeys }: { pubkeys: string[] }) {
  const shown = pubkeys.slice(0, 8);
  const extra = pubkeys.length > 8 ? pubkeys.length - 8 : 0;
  return (
    <span>
      {shown.map((pk, i) => (
        <span key={pk}>
          <ReactionTooltipName pubkey={pk} />
          {i < shown.length - 1 && ", "}
        </span>
      ))}
      {extra > 0 && ` +${extra} more`}
    </span>
  );
}

function ChatMessageBubble({
  msg,
  isMine,
  isClusterStart,
  isClusterEnd,
  delivered,
  isMod,
  isDeleted,
  replyToDeleted,
  isRemovedUser,
  reactions,
  reactionPubkeys,
  reactionEmojiUrls,
  customEmojis,
  allMessages,
  onDelete,
  onRemoveUser,
  onReply,
  onReact,
  onReactCustom,
  mentionsMe,
  onPin,
  isPinnedMsg }: {
  msg: GroupMessage;
  isMine: boolean;
  isClusterStart: boolean;
  isClusterEnd: boolean;
  delivered?: boolean;
  isMod: boolean;
  isDeleted?: boolean;
  replyToDeleted?: boolean;
  isRemovedUser?: boolean;
  reactions?: Record<string, number>;
  reactionPubkeys?: Record<string, string[]>;
  reactionEmojiUrls?: Record<string, string>;
  customEmojis?: CustomEmoji[];
  allMessages?: GroupMessage[];
  onDelete?: (id: string) => void;
  onRemoveUser?: (pubkey: string) => void;
  onReply?: (id: string) => void;
  onReact?: (id: string, emoji: string) => void;
  onReactCustom?: (id: string, emoji: CustomEmoji) => void;
  mentionsMe?: boolean;
  onPin?: (id: string | null) => void;
  isPinnedMsg?: boolean;
}) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, msg.pubkey), [msg.pubkey]);
  // No profile in the store yet → trigger a fetch so the raw npub resolves to a
  // real name instead of lingering as a bare identifier.
  useEffect(() => { if (!profile) fetchProfilesCached([msg.pubkey]); }, [profile, msg.pubkey]);
  const name = profile ? getDisplayName(profile) : shortenNpub(formatNpub(msg.pubkey));
  const avatar = profile ? getAvatarUrl(profile) : undefined;
  const content = profile ? getProfileContent(profile) : undefined;
  const npub = useMemo(() => nip19.npubEncode(msg.pubkey), [msg.pubkey]);

  const [showActions, setShowActions] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiTriggerRef = useRef<HTMLButtonElement>(null);
  const touchRef = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    if (!showEmojiPicker) return;
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (
        emojiPickerRef.current && !emojiPickerRef.current.contains(target) &&
        emojiTriggerRef.current && !emojiTriggerRef.current.contains(target)
      ) {
        setShowEmojiPicker(false);
        setShowCustomPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [showEmojiPicker]);

  if (isDeleted) {
    return (
      <div className={`flex ${isMine ? "justify-end" : "justify-start"} px-2 sm:px-3 mt-0.5`}>
        <div className={`${!isMine ? "ml-[34px]" : ""} rounded-2xl px-3 py-1.5 border border-border/30 bg-muted/20 opacity-60`}>
          <p className="text-[11px] text-muted-foreground/60 italic flex items-center gap-1">
            <Trash2 className="w-2.5 h-2.5" />
            Message deleted by moderator
          </p>
        </div>
      </div>
    );
  }

  const actionToolbar = (showActions || (isMod && false)) ? (
    <div className={`flex items-center gap-0.5 self-center shrink-0 transition-opacity ${showActions ? "opacity-100" : "opacity-0"}`}>
      {onReact && (
        <button
          ref={emojiTriggerRef}
          onClick={(e) => { e.stopPropagation(); setShowEmojiPicker((prev) => !prev); }}
          className="p-1.5 sm:p-1 rounded-full hover:bg-muted/50 text-muted-foreground/50 hover:text-muted-foreground"
          title="React"
        >
          <Smile className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
        </button>
      )}
      {onReply && (
        <button
          onClick={(e) => { e.stopPropagation(); onReply(msg.id); setShowActions(false); }}
          className="p-1.5 sm:p-1 rounded-full hover:bg-muted/50 text-muted-foreground/50 hover:text-muted-foreground"
          title="Reply"
        >
          <Reply className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
        </button>
      )}
      {isMod && onPin && (
        <button
          onClick={(e) => { e.stopPropagation(); onPin(isPinnedMsg ? null : msg.id); }}
          className={`p-1.5 sm:p-1 rounded-full hover:bg-brand/10 ${isPinnedMsg ? "text-brand" : "text-muted-foreground/50 hover:text-brand"}`}
          title={isPinnedMsg ? "Unpin message" : "Pin message"}
        >
          <Pin className={`w-4 h-4 sm:w-3.5 sm:h-3.5 ${isPinnedMsg ? "fill-current" : ""}`} />
        </button>
      )}
      {isMod && onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(msg.id); }}
          className="p-1.5 sm:p-1 rounded-full hover:bg-red-500/10 text-muted-foreground/50 hover:text-red-500"
          title="Delete message"
        >
          <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
        </button>
      )}
      {isMod && onRemoveUser && !isMine && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemoveUser(msg.pubkey); }}
          className="p-1.5 sm:p-1 rounded-full hover:bg-red-500/10 text-muted-foreground/50 hover:text-red-500"
          title="Remove user from group"
        >
          <UserMinus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
        </button>
      )}
    </div>
  ) : null;

  return (
    <div
      className={`group flex items-end gap-1.5 px-2 sm:px-3 ${isMine ? "justify-end" : "justify-start"} ${isClusterStart ? "mt-2.5" : "mt-0.5"} ${mentionsMe ? "bg-brand/[0.07]/[0.10] rounded-lg py-0.5 border-l-2 border-brand/60" : ""}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setShowEmojiPicker(false); }}
      onTouchStart={(e) => { const t = e.touches[0]; touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() }; }}
      onTouchMove={(e) => {
        if (!touchRef.current || !onReply) return;
        const t = e.touches[0];
        const dx = t.clientX - touchRef.current.x;
        const dy = t.clientY - touchRef.current.y;
        if (Math.abs(dx) > Math.abs(dy) && dx > 0) setSwipeX(Math.min(dx, 64));
      }}
      onTouchEnd={(e) => {
        const start = touchRef.current;
        touchRef.current = null;
        const sx = swipeX;
        setSwipeX(0);
        if (onReply && sx >= 48) { onReply(msg.id); return; }
        // A tap that lands on an action control (react/reply/pin/delete button,
        // the emoji picker, or a link) must NOT be treated as a background tap:
        // touchend fires before the synthesized click and bubbles up here, so
        // toggling the toolbar off now would unmount the button before its
        // onClick runs — the mobile "options appear then vanish when I tap them"
        // bug. Let the control handle its own tap instead.
        const el = e.target as HTMLElement | null;
        if (el && el.closest('button, a, [role="button"]')) return;
        if (start && Date.now() - start.t < 400 && sx < 8 && window.matchMedia("(pointer: coarse)").matches) {
          setShowActions((prev) => !prev);
        }
      }}
      data-testid={`chat-msg-${msg.id}`}
    >
      {isMine && actionToolbar}

      {!isMine && (
        isClusterStart ? (
          <Link
            href={`/profile/${npub}`}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label={`View ${name}'s profile`}
            data-testid={`chat-avatar-link-${msg.pubkey.slice(0, 12)}`}
          >
            <Avatar className="w-7 h-7 mb-0.5 border border-border/50">
              {avatar && <AvatarImage src={avatar} alt={name} />}
              <AvatarFallback className="text-[9px] bg-brand/10 text-brand">
                {name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </Link>
        ) : (
          <div className="w-7 shrink-0" />
        )
      )}

      <div
        className="relative min-w-0 max-w-[80%] sm:max-w-[68%]"
        style={swipeX ? { transform: `translateX(${swipeX}px)`, transition: "none" } : { transition: "transform 0.15s" }}
      >
        {!isMine && isClusterStart && (
          <div className="flex items-center gap-1.5 mb-0.5 ml-1">
            <Link
              href={`/profile/${npub}`}
              onClick={(e) => e.stopPropagation()}
              className={`block min-w-0 truncate -my-1 py-1 rounded no-underline text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${profile ? "hover:opacity-80" : "text-muted-foreground hover:text-foreground/70"}`}
              // Slack-style deterministic sender hue (curated AA palette, see
              // lib/sender-color.ts) — resolved names only; a raw-npub fallback
              // stays muted/neutral, never colored.
              style={profile ? { color: senderColor(msg.pubkey) } : undefined}
              data-testid={`chat-name-link-${msg.pubkey.slice(0, 12)}`}
            >
              {name}
            </Link>
            <PersonBadges pubkey={msg.pubkey} nip05={content?.nip05} claimedName={content?.display_name || content?.name} showCollision={!!profile} />
            <WotDot pubkey={msg.pubkey} />
            {isRemovedUser && (
              <span className="text-[8px] text-red-600/50 dark:text-red-400/50 flex items-center gap-0.5">
                <UserMinus className="w-2 h-2" />
                removed
              </span>
            )}
          </div>
        )}

        <div
          className={`rounded-2xl px-3 py-2 border ${isMine ? "glass-bubble-own" : "glass-bubble-other"} ${
            isMine ? (isClusterEnd ? "rounded-br-md" : "") : (isClusterEnd ? "rounded-bl-md" : "")
          }`}
        >
          {msg.replyTo && (() => {
            const repliedMsg = allMessages?.find((m) => m.id === msg.replyTo);
            return (
              <div className="mb-1 rounded-md border-l-2 border-primary/50 bg-black/[0.06] dark:bg-white/[0.07] px-2 py-1">
                <ReplyPreviewAuthor pubkey={replyToDeleted ? undefined : repliedMsg?.pubkey} />
                <p className="text-[10px] opacity-70 truncate mt-0.5 leading-snug">
                  {replyToDeleted
                    ? "Message deleted by moderator"
                    : repliedMsg?.content
                      ? repliedMsg.content.length > 100 ? repliedMsg.content.slice(0, 100) + "…" : repliedMsg.content
                      : "Message not found"}
                </p>
              </div>
            );
          })()}
          <div className="text-sm leading-relaxed break-words">
            <ChatContentRenderer content={msg.content} tags={msg.tags} eventId={msg.id} pubkey={msg.pubkey} />
          </div>
          {isClusterEnd && (
            <div className={`flex items-center gap-1 mt-0.5 text-[9px] opacity-50 ${isMine ? "justify-end" : "justify-start"}`}>
              <span>{formatDistanceToNow(msg.createdAt * 1000, { addSuffix: true })}</span>
              {isMine && (delivered ? <Check className="w-3 h-3" /> : <Clock className="w-2.5 h-2.5" />)}
            </div>
          )}
        </div>

        {reactions && Object.keys(reactions).length > 0 && (
          <div className={`mt-1 flex flex-wrap gap-1 ${isMine ? "justify-end" : ""}`}>
            {Object.entries(reactions)
              .sort((a, b) => b[1] - a[1])
              .map(([emoji, count]) => {
                const pubkeys = reactionPubkeys?.[emoji];
                const emojiUrl = reactionEmojiUrls?.[emoji];
                const display = getReactionDisplay(emoji, emojiUrl);
                const btn = (
                  <button
                    key={emoji}
                    onClick={(e) => { e.stopPropagation(); onReact?.(msg.id, emoji); }}
                    className="inline-flex items-center gap-1 px-2 py-1 sm:py-0.5 min-h-7 sm:min-h-0 rounded-full text-sm sm:text-[11px] bg-muted/40 hover:bg-muted/60 active:bg-muted/70 border border-border/20 transition-colors"
                  >
                    <span className="inline-flex items-center">{display}</span>
                    <span className="text-muted-foreground/60">{count}</span>
                  </button>
                );
                if (pubkeys && pubkeys.length > 0) {
                  return (
                    <Tooltip key={emoji}>
                      <TooltipTrigger asChild>{btn}</TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[220px] text-xs">
                        <ReactionTooltipNames pubkeys={pubkeys} />
                      </TooltipContent>
                    </Tooltip>
                  );
                }
                return btn;
              })}
          </div>
        )}

        {showEmojiPicker && onReact && (
          <div
            ref={emojiPickerRef}
            className={`absolute bottom-full mb-1 z-50 ${isMine ? "right-0" : "left-0"} max-w-[calc(100vw-1rem)] bg-background/95 backdrop-blur border border-border/30 rounded-lg p-1.5 sm:p-1 shadow-lg`}
          >
            <div className="flex flex-wrap items-center gap-0.5">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReact(msg.id, emoji);
                    setShowEmojiPicker(false);
                    setShowActions(false);
                  }}
                  className="p-2 sm:p-1 rounded hover:bg-muted/50 text-lg sm:text-sm transition-transform hover:scale-125 active:scale-95"
                >
                  {emoji}
                </button>
              ))}
              {customEmojis && customEmojis.length > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowCustomPicker((v) => !v); }}
                  className="p-2 sm:p-1 rounded hover:bg-muted/50 text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                  title="Custom stickers"
                >
                  <Plus className="w-4 h-4 sm:w-3 sm:h-3" />
                </button>
              )}
            </div>
            {showCustomPicker && customEmojis && customEmojis.length > 0 && (
              <div className="mt-1 border-t border-border/20 pt-1 max-h-40 overflow-y-auto">
                <div className="grid grid-cols-6 gap-0.5">
                  {customEmojis.map((ce) => (
                    <button
                      key={ce.shortcode}
                      onClick={(e) => {
                        e.stopPropagation();
                        onReactCustom?.(msg.id, ce);
                        setShowEmojiPicker(false);
                        setShowCustomPicker(false);
                        setShowActions(false);
                      }}
                      className="p-1 rounded hover:bg-muted/50 transition-transform hover:scale-110 active:scale-95"
                      title={`:${ce.shortcode}:`}
                    >
                      <img src={ce.url} alt={ce.shortcode} className="w-6 h-6 object-contain" loading="lazy" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!isMine && actionToolbar}
    </div>
  );
}

type RoomFilter = "all" | "joined" | "pinned";

function formatActivity(ts: number | undefined): string | null {
  if (!ts) return null;
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 60) return "Active now";
  if (diff < 3600) return `Active ${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `Active ${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `Active ${Math.floor(diff / 86400)}d ago`;
  return `Active ${Math.floor(diff / 604800)}w ago`;
}

const PAGE_SIZE = 30;

function GroupCard({
  group,
  isJoined,
  isPending,
  isPinned,
  isQuickAccessPinned,
  lastActivity,
  unread,
  onSelect,
  onJoin,
  onLeave,
  onTogglePin,
  onToggleQuickAccessPin,
  joining }: {
  group: GroupMetadata;
  isJoined: boolean;
  isPending?: boolean;
  isPinned: boolean;
  isQuickAccessPinned?: boolean;
  lastActivity?: number;
  unread?: boolean;
  onSelect: () => void;
  onJoin?: () => void;
  onLeave?: () => void;
  onTogglePin?: () => void;
  onToggleQuickAccessPin?: () => void;
  joining?: boolean;
}) {
  const activityLabel = formatActivity(lastActivity);
  const isRecentlyActive = lastActivity && (Math.floor(Date.now() / 1000) - lastActivity) < 3600;

  return (
    // h-full + flex column so every card in a grid row is the same height AND
    // its meta row can be pushed to a shared baseline. Without this the cards
    // were equal-height boxes with unequal insides: a room WITH a description
    // pushed its "Active …" line lower than one without, so the two columns
    // never lined up.
    <div className="w-full h-full flex flex-col text-left glass-card border border-border/30 rounded-lg p-3 hover:border-primary/30 hover:bg-primary/5 transition-all">
      {/* One row on desktop; two on a phone. Sharing a 322px row with a 44px
          pin and a Join button left the room NAME 79px — "welcome-everyone"
          arrived as "welcome-ev…", on the one line that says which room this
          is. Below md the actions get their own right-aligned line and the
          name gets the whole width. */}
      <div className="flex flex-col md:flex-row md:items-start gap-1.5 md:gap-3 flex-1 min-h-0">
        <button onClick={onSelect} className="flex items-start gap-3 flex-1 min-w-0 text-left h-full">
          {group.picture ? (
            <Avatar className="w-10 h-10 shrink-0 mt-0.5">
              <AvatarImage src={group.picture} alt={group.name || group.id} />
              <AvatarFallback className="bg-brand/10 text-brand text-xs">
                <Hash className="w-4 h-4" />
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Hash className="w-4 h-4 text-brand/70" />
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col h-full">
            <div className="flex items-center gap-1.5">
              {unread && <span className="w-2 h-2 rounded-full bg-primary shrink-0 shadow-[0_0_6px_rgba(139,92,246,0.6)]" aria-label="Unread messages" data-testid={`channel-unread-${group.id}`} />}
              <span className={`text-sm truncate ${unread ? "font-semibold text-foreground" : "font-medium text-foreground/90"}`}>
                {group.name || group.id}
              </span>
              {group.isPrivate && <Lock className="w-3 h-3 text-amber-600/60 dark:text-amber-400/60 shrink-0" />}
              {group.isClosed && <Shield className="w-3 h-3 text-red-600/60 dark:text-red-400/60 shrink-0" />}
            </div>
            {group.about && (
              <p className="text-[11px] text-muted-foreground/50 truncate mt-0.5">{group.about}</p>
            )}
            {/* mt-auto is what puts every card's meta row on the same line,
                whether or not the room above it had a description. */}
            {/* 11px, not 9px, and /50 rather than /30: index.css's legibility
                floor only rewrites /20–/50, so /30 opted itself out of the
                High and Maximum contrast presets entirely. */}
            <div className="flex items-center gap-2 mt-auto pt-1">
              {isPending && !isJoined && (
                <span className="text-[11px] text-amber-700/80 dark:text-amber-400/80 flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  Pending
                </span>
              )}
              {isJoined && !isPending && (
                <span className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 flex items-center gap-0.5">
                  <Eye className="w-2.5 h-2.5" />
                  Joined
                </span>
              )}
              {group.id === "_" && (
                <span className="text-[11px] text-brand/70">General</span>
              )}
              {activityLabel && (
                <span className={`text-[11px] flex items-center gap-0.5 ${isRecentlyActive ? "text-emerald-700/80 dark:text-emerald-400/80" : "text-muted-foreground/50"}`}>
                  <Clock className="w-2.5 h-2.5" />
                  {activityLabel}
                </span>
              )}
            </div>
          </div>
        </button>
        {/* 26px pin and a 28px Join, 2px apart, hard against a card-wide
            "open this room" button: a miss either opens a full-screen room or
            publishes a NIP-29 join request. On a phone the boxes have to grow,
            not just their hit areas — an invisible expanded target here would
            overlap both neighbours and make the same wrong-destination miss
            harder to see. Desktop keeps the compact sizes it was verified at. */}
        <div className="flex items-center justify-end gap-1.5 shrink-0 md:gap-0.5 md:-mt-0.5">
          {onTogglePin && (
            <button
              onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
              className={`w-11 h-11 flex items-center justify-center rounded md:w-auto md:h-auto md:p-1.5 transition-colors ${(isPinned || isQuickAccessPinned) ? "text-brand hover:text-brand/80" : "text-muted-foreground/40 hover:text-muted-foreground/70"}`}
              title={(isPinned || isQuickAccessPinned) ? "Unpin (top of list + sidebar)" : "Pin (top of list + sidebar)"}
            >
              <Pin className={`w-3.5 h-3.5 ${(isPinned || isQuickAccessPinned) ? "fill-current" : ""}`} />
            </button>
          )}
          {onJoin && onLeave && (
            <>
              {isJoined ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); onLeave(); }}
                  className="h-11 md:h-7 text-[10px] text-red-700/80 dark:text-red-400/80 hover:text-red-500 gap-1 px-2"
                >
                  <LogOut className="w-3 h-3" />
                  Leave
                </Button>
              ) : isPending ? (
                // Nothing: the meta row above already carries "Pending". One
                // state, one word — this column used to spend ~80px repeating
                // it as "Requested" on the card that has the least room and is
                // the hardest to identify.
                null
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); onJoin(); }}
                  disabled={joining}
                  className="h-11 md:h-7 text-[10px] text-emerald-700/80 dark:text-emerald-400/80 gap-1 px-2"
                >
                  <LogIn className="w-3 h-3" />
                  {joining ? "Joining…" : "Join"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatRoomView({
  relayUrl,
  group,
  isInitiallyJoined,
  isInitiallyPending,
  isPinned,
  isQuickAccessPinned,
  autoOpenAddMember,
  onAutoOpenAddMemberConsumed,
  onBack,
  onTogglePin,
  onToggleQuickAccessPin,
  onPendingStateChange,
  onGroupMetaChanged,
  initialInviteCode,
  trustFilterEnabled,
  isHiddenByTrust,
  onTrustHidden }: {
  relayUrl: string;
  group: GroupMetadata;
  isInitiallyJoined: boolean;
  isInitiallyPending: boolean;
  isPinned?: boolean;
  isQuickAccessPinned?: boolean;
  autoOpenAddMember?: boolean;
  onAutoOpenAddMemberConsumed?: () => void;
  onBack: () => void;
  onTogglePin?: () => void;
  onToggleQuickAccessPin?: () => void;
  onPendingStateChange?: (groupId: string, pending: boolean) => void;
  /**
   * This room's kind-39000 changed and we re-read it — hand the fresh copy up.
   *
   * Without this the door switches publish successfully and then snap back:
   * they are controlled by `group`, which is the parent's state, and nothing
   * re-fetches it. A control that works and looks broken is worse than one
   * that is missing.
   */
  onGroupMetaChanged?: (meta: GroupMetadata) => void;
  initialInviteCode?: string;
  trustFilterEnabled?: boolean;
  isHiddenByTrust?: (pubkey: string) => boolean;
  onTrustHidden?: (count: number) => void;
}) {
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [rawEvents, setRawEvents] = useState<NostrEvent[]>([]);
  const [systemEvents, setSystemEvents] = useState<ChatSystemEvent[]>([]);
  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(group.pinnedMessageId ?? null);
  // Per-channel "last read" timestamp (localStorage) → drives the unread divider.
  // Captured once when the channel opens so the divider stays put while reading.
  const [lastReadTs] = useState<number>(() => readChannelLastRead(relayUrl, group.id));
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [removedUsers, setRemovedUsers] = useState<Map<string, number>>(new Map());
  const [reactionMap, setReactionMap] = useState<Record<string, Record<string, number>>>({});
  const [reactionPubkeys, setReactionPubkeys] = useState<Record<string, Record<string, string[]>>>({});
  const [reactionEmojiUrls, setReactionEmojiUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [removeUserConfirm, setRemoveUserConfirm] = useState<string | null>(null);
  const [showComposeEmoji, setShowComposeEmoji] = useState(false);
  const composeEmojiRef = useRef<HTMLDivElement>(null);
  const composeEmojiTriggerRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pubkeyRef = useRef(pubkey);
  pubkeyRef.current = pubkey;
  // Ids the relay has echoed back (own messages move from "sending" to delivered).
  const [deliveredIds, setDeliveredIds] = useState<Record<string, true>>({});

  useEffect(() => {
    if (!showComposeEmoji) return;
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (
        composeEmojiRef.current && !composeEmojiRef.current.contains(target) &&
        composeEmojiTriggerRef.current && !composeEmojiTriggerRef.current.contains(target)
      ) {
        setShowComposeEmoji(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [showComposeEmoji]);
  const [isJoined, setIsJoined] = useState(isInitiallyJoined);
  const [isPendingJoin, setIsPendingJoin] = useState(isInitiallyPending);
  const [joining, setJoining] = useState(false);
  const [relayMembers, setRelayMembers] = useState<string[]>([]);
  const [admins, setAdminsLocal] = useState<GroupAdmin[]>([]);
  const [adminsLoaded, setAdminsLoaded] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  // null = still asking. false = we never got a socket, so nothing this relay
  // "said" about membership means anything.
  const [rosterReached, setRosterReached] = useState<boolean | null>(null);

  const pendingJoinRef = useRef(isInitiallyPending);
  pendingJoinRef.current = isPendingJoin;
  const onPendingRef = useRef(onPendingStateChange);
  onPendingRef.current = onPendingStateChange;

  useEffect(() => {
    setRosterReached(null);
    fetchGroupMembersResult(relayUrl, group.id)
      .then(({ data: mems, reached }) => {
        setRosterReached(reached);
        setRelayMembers(mems);
        // Only a REACHED relay can tell us we're a member. An empty list from a
        // relay we never opened a socket to is not evidence of anything, and
        // treating it as one is what put a Join button in front of people who
        // were already in the room.
        if (reached && pubkey && mems.includes(pubkey)) {
          setIsJoined(true);
          if (pendingJoinRef.current) {
            setIsPendingJoin(false);
            onPendingRef.current?.(group.id, false);
          }
        }
      })
      .catch(() => setRosterReached(false));
    // `adminsLoaded` exists because [] means three different things here:
    // still fetching, genuinely nobody, and the relay refused. Without it the
    // drawer cannot tell "loading" from "nothing for you" and would flash
    // "You don't run this room." at a real moderator.
    setAdminsLoaded(false);
    fetchGroupAdminsResult(relayUrl, group.id)
      .then(({ data: adms }) => { setAdminsLocal(adms); setAdminsLoaded(true); })
      .catch(() => setAdminsLoaded(true));
  }, [relayUrl, group.id, pubkey]);

  const members = useMemo(() => {
    const chatPubkeys = [...new Set(messages.map((m) => m.pubkey))];
    if (relayMembers.length > 0) {
      const combined = new Set(relayMembers);
      chatPubkeys.forEach((pk) => combined.add(pk));
      return [...combined];
    }
    return chatPubkeys;
  }, [relayMembers, messages]);

  // One bit, ONE reader. This used to hand-inline `admins.some(a => a.pubkey ===
  // pubkey)` — a second raw compare, alongside the one in isGroupModerator, so a
  // relay tag in npub form or uppercase hex reported "not a moderator" for
  // someone who plainly is. Same defect that locked a real operator out of the
  // ops dashboard (#461). nip29Capabilities normalizes both sides.
  const caps = useMemo(() => nip29Capabilities(admins, pubkey), [admins, pubkey]);
  const isMod = hasAnyCapability(caps);

  // Whether the RELAY lists us as an admin — nothing else.
  //
  // This used to OR in a localStorage set of groups created on this device, so
  // the creator saw Settings and Delete before the relay's kind-39001 caught up.
  // Well-meant and wrong: the optimism was device-local, so the same person got
  // different powers on their phone and their laptop, and every action it
  // enabled was one the relay would refuse anyway. Worse, it made the app's
  // answer to "who runs this?" disagree with the relay's, which is the one
  // question this product claims to answer honestly.
  //
  // Dropped. `createdHereButNotListed` below turns that state into a sentence
  // instead of a silently-broken button.
  const isOwner = isMod;

  // You made this room on this device, but the relay does not list you yet (or
  // never will). Worth SAYING — the alternative is controls that vanished with
  // no explanation.
  const createdHereButNotListed = useMemo(
    () => !isMod && loadCreatedGroups().has(createdGroupKey(relayUrl, group.id)),
    [isMod, relayUrl, group.id],
  );

  const canCompose = !!pubkey && (isJoined || !group.isRestricted);

  const renderItems = useMemo(() => buildChatRenderItems(messages, systemEvents, pubkey, lastReadTs), [messages, systemEvents, pubkey, lastReadTs]);

  // Trust filter: collapse (don't silently drop) consecutive runs of messages
  // whose author the parent flags as low-trust. The parent's predicate already
  // keeps unscored/loading authors visible, so this is flicker-safe.
  // Runs that the reader taps open are tracked locally by a stable run-key
  // (the id of the first message in the run).
  const [revealedTrustRuns, setRevealedTrustRuns] = useState<Set<string>>(new Set());
  // Forget reveals when switching channels.
  useEffect(() => {
    setRevealedTrustRuns(new Set());
  }, [group.id]);

  type ChatDisplayRow =
    | { kind: "item"; key: string; item: ChatRenderItem }
    | { kind: "trust-collapsed"; key: string; runKey: string; items: Extract<ChatRenderItem, { type: "msg" }>[] };

  const displayRows = useMemo<ChatDisplayRow[]>(() => {
    const trustOn = !!trustFilterEnabled && !!isHiddenByTrust;
    if (!trustOn) {
      return renderItems.map((item) => ({ kind: "item" as const, key: item.key, item }));
    }
    const rows: ChatDisplayRow[] = [];
    let run: Extract<ChatRenderItem, { type: "msg" }>[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const runKey = run[0].key;
      if (revealedTrustRuns.has(runKey)) {
        for (const m of run) rows.push({ kind: "item", key: m.key, item: m });
      } else {
        rows.push({ kind: "trust-collapsed", key: `trust-run-${runKey}`, runKey, items: run });
      }
      run = [];
    };
    for (const item of renderItems) {
      if (item.type === "msg" && isHiddenByTrust!(item.msg.pubkey)) {
        run.push(item);
        continue;
      }
      flush();
      rows.push({ kind: "item", key: item.key, item });
    }
    flush();
    return rows;
  }, [renderItems, trustFilterEnabled, isHiddenByTrust, revealedTrustRuns]);

  // Report the total number of messages currently hidden (i.e. in collapsed,
  // not-revealed runs). Report 0 when the filter is off.
  useEffect(() => {
    if (!onTrustHidden) return;
    if (!trustFilterEnabled || !isHiddenByTrust) {
      onTrustHidden(0);
      return;
    }
    let count = 0;
    for (const row of displayRows) {
      if (row.kind === "trust-collapsed") count += row.items.length;
    }
    onTrustHidden(count);
  }, [displayRows, trustFilterEnabled, isHiddenByTrust, onTrustHidden]);

  const revealTrustRun = useCallback((runKey: string) => {
    setRevealedTrustRuns((prev) => {
      const next = new Set(prev);
      next.add(runKey);
      return next;
    });
  }, []);

  // Viewing this channel marks it read up to the newest item shown, so the
  // unread divider only returns for genuinely new history on the next visit.
  useEffect(() => {
    let newest = 0;
    for (const m of messages) if (m.createdAt > newest) newest = m.createdAt;
    for (const s of systemEvents) if (s.createdAt > newest) newest = s.createdAt;
    if (newest > 0) writeChannelLastRead(relayUrl, group.id, newest);
  }, [messages, systemEvents, relayUrl, group.id]);

  const [pendingRequests, setPendingRequests] = useState<JoinRequest[]>([]);
  const [showRequestsPanel, setShowRequestsPanel] = useState(false);
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);

  useEffect(() => {
    if (autoOpenAddMember) {
      setShowAddMember(true);
      onAutoOpenAddMemberConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenAddMember, group.id]);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  // Channel settings (owner): edit + delete
  const [showSettings, setShowSettings] = useState(false);
  // The door, edited separately from name/about — see the save handler below.
  const [savingDoor, setSavingDoor] = useState(false);
  // One derivation for both the switches and the drawer's read-only summary, so
  // the two surfaces cannot describe the same room differently.
  const door = { join: joinDoor(group), read: readDoor(group) };
  const [editName, setEditName] = useState(group.name || "");
  const [editAbout, setEditAbout] = useState(group.about || "");
  const [editPicture, setEditPicture] = useState<File | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Invite by link / DM
  const [inviteRecipient, setInviteRecipient] = useState<SelectedRecipient | null>(null);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [approvingPubkey, setApprovingPubkey] = useState<string | null>(null);

  useEffect(() => {
    // `!isOpen`, never `!isClosed` — see the note on handleJoin below. A room
    // whose kind-39000 the relay declined to serve has NEITHER tag, and
    // skipping it here is how a moderator is shown an empty queue for a room
    // that has people waiting in it.
    if (!isMod || group.isOpen) return;
    fetchJoinRequests(relayUrl, group.id).then((reqs) => {
      setPendingRequests(reqs);
      if (reqs.length > 0) fetchProfilesCached(reqs.map((r) => r.pubkey));
    }).catch(() => {});
  }, [relayUrl, group.id, isMod, group.isOpen]);

  useEffect(() => {
    if (!isMod || group.isOpen) return;
    let closed = false;
    const sub = subscribeToRoomRelay(
      relayUrl,
      { kinds: [KIND_GROUP_JOIN_REQUEST], "#h": [group.id], since: Math.floor(Date.now() / 1000) },
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          setPendingRequests((prev) => {
            if (prev.some((r) => r.pubkey === e.pubkey)) return prev;
            fetchProfilesCached([e.pubkey]);
            return [{
              pubkey: e.pubkey,
              createdAt: e.created_at,
              eventId: e.id,
              code: e.tags.find((t) => t[0] === "code")?.[1] }, ...prev];
          });
        },
        oneose() {} },
    );
    return () => { closed = true; sub.close(); };
  }, [relayUrl, group.id, isMod, group.isOpen]);

  const filteredRequests = useMemo(() =>
    pendingRequests.filter((r) => !members.includes(r.pubkey)),
    [pendingRequests, members]
  );

  const handleApproveRequest = useCallback(async (requestPubkey: string) => {
    setApprovingPubkey(requestPubkey);
    try {
      const { ok: success, error } = await sendPutUser(relayUrl, group.id, requestPubkey);
      if (success) {
        setPendingRequests((prev) => prev.filter((r) => r.pubkey !== requestPubkey));
        setRelayMembers((prev) => [...prev, requestPubkey]);
        // The Needs-you badge is swept at App level and cannot see this room's
        // state; without this it keeps counting somebody who is already in.
        notifyNeedsYouChanged();
        toast({ title: "User approved" });
      } else {
        toast({ title: "Couldn't approve them", description: error ?? "The relay didn't accept it.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setApprovingPubkey(null);
    }
  }, [relayUrl, group.id, toast]);

  const handleDismissRequest = useCallback((requestPubkey: string) => {
    setPendingRequests((prev) => prev.filter((r) => r.pubkey !== requestPubkey));
  }, []);

  const handleGenerateInvite = useCallback(async () => {
    setGeneratingInvite(true);
    try {
      const arr = new Uint8Array(8);
      crypto.getRandomValues(arr);
      const code = Array.from(arr, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
      const { ok: success, error } = await sendCreateInvite(relayUrl, group.id, code);
      if (success) {
        setInviteCode(code);
        toast({ title: "Invite code created" });
      } else {
        toast({ title: "Couldn't create the invite", description: error ?? "The relay didn't accept it.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setGeneratingInvite(false);
    }
  }, [relayUrl, group.id, toast]);

  const handleCopyInvite = useCallback(() => {
    navigator.clipboard.writeText(inviteCode);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  }, [inviteCode]);

  const handleCopyLink = useCallback(() => {
    const link = buildChannelInviteLink(relayUrl, group.id, inviteCode || undefined, pubkey ? formatNpub(pubkey) : undefined);
    navigator.clipboard.writeText(link);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }, [relayUrl, group.id, inviteCode, pubkey]);

  const handleSendInviteDM = useCallback(async () => {
    // Use the session signer (any login method), not just a window.nostr
    // extension — otherwise local-key / PWA users could never send the invite.
    const dmSigner = signer || (window as any).nostr;
    if (!inviteRecipient?.pubkey || !pubkey || !dmSigner) return;
    setSendingInvite(true);
    try {
      const link = buildChannelInviteLink(relayUrl, group.id, inviteCode || undefined, formatNpub(pubkey));
      const chName = group.name || group.id;
      const content = `You're invited to join the channel "${chName}". Tap to open and join:\n\n${link}`;
      const res = await sendDM({ signer: dmSigner, senderPubkey: pubkey, recipientPubkey: inviteRecipient.pubkey, content });
      if (res.success) {
        toast({ title: "Invite sent", description: `Sent to ${inviteRecipient.displayName || "the user"}.` });
        setInviteRecipient(null);
      } else {
        toast({ title: "Couldn't send", description: res.error || "Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setSendingInvite(false);
    }
  }, [inviteRecipient, pubkey, signer, relayUrl, group.id, group.name, inviteCode, toast]);

  const handleSaveSettings = useCallback(async () => {
    if (!editName.trim()) return;
    setSavingSettings(true);
    try {
      let pictureUrl: string | undefined;
      const uploadSigner = signer || (window as any).nostr;
      if (editPicture && uploadSigner) {
        try {
          const result = await uploadMedia(editPicture, undefined, uploadSigner);
          if (result?.url) pictureUrl = result.url;
        } catch {}
      }
      const { ok, error } = await sendEditMetadata(relayUrl, group.id, {
        name: editName.trim(),
        about: editAbout.trim() || undefined,
        picture: pictureUrl,
      });
      if (ok) {
        toast({ title: "Room updated" });
        setEditPicture(null);
        setShowSettings(false);
      } else {
        toast({ title: "Update failed", description: error ?? "The room is unchanged.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setSavingSettings(false);
    }
  }, [editName, editAbout, editPicture, relayUrl, group.id, toast]);

  /**
   * Change the door. Separate act, separate button, separate confirmation.
   *
   * NOT folded into "Save changes" with the name and description, for the same
   * reason sendEditAccess is its own function: a rename is cosmetic and a door
   * is authority. One button doing both means every typo fix restates who may
   * get in, and a stale form value silently reopens a room somebody closed.
   *
   * Fires immediately on toggle rather than waiting for a Save press — there is
   * exactly one bit to change and the current state is visible right there, so
   * a pending-but-unsaved door would be its own kind of lie.
   */
  const applyDoor = useCallback(async (next: { isPrivate: boolean; isClosed: boolean }) => {
    setSavingDoor(true);
    try {
      const { ok, error } = await sendEditAccess(relayUrl, group.id, next);
      if (ok) {
        // Re-READ rather than assume. The relay normalises — it drops the
        // default-valued tag and expresses "open" by REMOVING `closed` — so the
        // only honest source for what the door now IS, is the relay's own
        // 39000. An optimistic local flip would also be showing the operator a
        // state the relay might have declined to store.
        try {
          const fresh = (await fetchGroupMetadata(relayUrl)).find((g) => g.id === group.id);
          if (fresh) onGroupMetaChanged?.(fresh);
        } catch {
          // The write succeeded; a failed re-read is not a failed change, and
          // saying otherwise would be the worse lie.
        }
        toast({
          title: next.isClosed ? "New members need approval" : "Anyone can join",
          description: next.isPrivate ? "Only members can read this room." : "Anyone can read this room.",
        });
      } else {
        // The relay is the arbiter and may simply decline. Say that rather than
        // showing a flipped switch for a change that never landed.
        toast({
          title: "The relay didn't accept that",
          description: error ?? "This room's access is unchanged.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Couldn't change access", variant: "destructive" });
    } finally {
      setSavingDoor(false);
    }
  }, [relayUrl, group.id, toast, onGroupMetaChanged]);

  const handleDeleteChannel = useCallback(async () => {
    setDeleting(true);
    try {
      const { ok, error } = await sendDeleteGroup(relayUrl, group.id);
      if (ok) {
        toast({ title: "Room deleted" });
        if (pubkey) {
          try {
            const base = await loadSimpleGroupsBase(pubkey);
            if (!base.blocked) {
              const norm = relayUrl.replace(/\/+$/, "");
              await publishSimpleGroupsList(base.entries.filter((e) => !(e.groupId === group.id && e.relayUrl.replace(/\/+$/, "") === norm)));
            }
          } catch {}
        }
        setConfirmDelete(false);
        setShowSettings(false);
        onBack();
      } else {
        toast({ title: "Delete failed", description: error ?? "The room is still there.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }, [relayUrl, group.id, pubkey, toast, onBack]);

  useEffect(() => {
    setLoading(true);
    const msgs: NostrEvent[] = [];
    let closed = false;

    const chatSub = subscribeToRoomRelay(
      relayUrl,
      { kinds: [KIND_GROUP_CHAT], "#h": [group.id], limit: 100 },
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          msgs.push(e);
          const parsed = parseGroupMessage(e);
          if (parsed) {
            setMessages((prev) => {
              if (prev.find((m) => m.id === parsed.id)) return prev;
              return insertSorted(prev, parsed, (m) => m.createdAt);
            });
            setRawEvents((prev) => {
              if (prev.find((e2) => e2.id === e.id)) return prev;
              return insertSorted(prev, e, (ev) => ev.created_at);
            });
            // The relay echoed our own message back → mark it delivered.
            if (parsed.pubkey === pubkeyRef.current) {
              setDeliveredIds((prev) => prev[parsed.id] ? prev : { ...prev, [parsed.id]: true });
            }
          }
          fetchProfilesCached([e.pubkey]);
        },
        oneose() {
          if (closed) return;
          setLoading(false);
          const pubkeys = [...new Set(msgs.map((e) => e.pubkey))];
          fetchProfilesCached(pubkeys);
        } },
    );

    const modSub = subscribeToRoomRelay(
      relayUrl,
      { kinds: [KIND_GROUP_DELETE_EVENT, KIND_GROUP_REMOVE_USER, KIND_GROUP_PUT_USER], "#h": [group.id], limit: 100 },
      {
        onevent(e: NostrEvent) {
          if (closed) return;
          if (e.kind === KIND_GROUP_DELETE_EVENT) {
            const targetId = e.tags.find((t) => t[0] === "e")?.[1];
            if (targetId) {
              setDeletedIds((prev) => new Set([...prev, targetId]));
            }
          }
          if (e.kind === KIND_GROUP_REMOVE_USER) {
            const targetPk = e.tags.find((t) => t[0] === "p")?.[1];
            if (targetPk) {
              setRemovedUsers((prev) => {
                const next = new Map(prev);
                const existing = next.get(targetPk);
                if (!existing || e.created_at > existing) {
                  next.set(targetPk, e.created_at);
                }
                return next;
              });
            }
          }
          // Membership changes → inline "joined/left" system lines. A single
          // 9000/9001 can carry multiple p-tags (batch add/remove).
          if (e.kind === KIND_GROUP_PUT_USER || e.kind === KIND_GROUP_REMOVE_USER) {
            const sysKind: "join" | "leave" = e.kind === KIND_GROUP_PUT_USER ? "join" : "leave";
            const pks = e.tags.filter((t) => t[0] === "p" && /^[0-9a-f]{64}$/i.test(t[1] || "")).map((t) => t[1]);
            if (pks.length) {
              const fetchSet = pks;
              setSystemEvents((prev) => {
                const seen = new Set(prev.map((s) => `${s.id}-${s.pubkey}`));
                const additions = pks
                  .map((pk) => ({ id: e.id, pubkey: pk, kind: sysKind, createdAt: e.created_at }))
                  .filter((s) => !seen.has(`${s.id}-${s.pubkey}`));
                return additions.length ? [...prev, ...additions] : prev;
              });
              fetchProfilesCached(fetchSet);
            }
          }
        },
        oneose() {} },
    );

    const seenReactions = new Set<string>();
    const reactSub = subscribeToRoomRelay(
      relayUrl,
      { kinds: [7], "#h": [group.id], limit: 200 },
      {
        onevent(e: NostrEvent) {
          if (closed || seenReactions.has(e.id)) return;
          seenReactions.add(e.id);
          const targetId = e.tags.find((t) => t[0] === "e")?.[1];
          if (!targetId || !e.content) return;
          const emoji = e.content;
          const emojiTag = e.tags.find((t) => t[0] === "emoji" && t[1] && t[2]);
          if (emojiTag) {
            setReactionEmojiUrls((prev) => {
              if (prev[emoji]) return prev;
              return { ...prev, [emoji]: emojiTag[2] };
            });
          }
          setReactionPubkeys((prev) => {
            const existing = prev[targetId] || {};
            const list = existing[emoji] || [];
            if (list.includes(e.pubkey)) return prev;
            const updated = [...list, e.pubkey];
            setReactionMap((prevMap) => {
              const ex = prevMap[targetId] || {};
              return { ...prevMap, [targetId]: { ...ex, [emoji]: updated.length } };
            });
            return { ...prev, [targetId]: { ...existing, [emoji]: updated } };
          });
          fetchProfilesCached([e.pubkey]);
        },
        oneose() {} },
    );

    return () => {
      closed = true;
      chatSub.close();
      modSub.close();
      reactSub.close();
    };
  }, [relayUrl, group.id]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    // On first load, land on the "new messages" divider if there is one;
    // afterwards, keep pinned to the latest message.
    if (!didInitialScrollRef.current && messages.length > 0) {
      didInitialScrollRef.current = true;
      const divider = container.querySelector('[data-testid="chat-unread-divider"]') as HTMLElement | null;
      if (divider) {
        divider.scrollIntoView({ block: "center" });
        return;
      }
    }
    container.scrollTop = container.scrollHeight;
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);
    const replyId = replyTo || undefined;
    // Clear the composer right away so it feels instant (Signal-style).
    setInputText("");
    if (inputRef.current) inputRef.current.style.height = "auto"; // collapse the autosized textarea
    setReplyTo(null);
    let optimisticId: string | null = null;
    try {
      const success = await sendGroupChat(relayUrl, group.id, text, rawEvents, replyId, (signed) => {
        // Render the message the moment it's signed, before the relay confirms.
        optimisticId = signed.id;
        const parsed = parseGroupMessage(signed);
        if (parsed) {
          setMessages((prev) => prev.find((m) => m.id === parsed.id) ? prev : insertSorted(prev, parsed, (m) => m.createdAt));
          setRawEvents((prev) => prev.find((e) => e.id === signed.id) ? prev : insertSorted(prev, signed, (ev) => ev.created_at));
        }
      });
      if (!success) {
        // Roll back the optimistic message and restore the composer.
        if (optimisticId) setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setInputText(text);
        if (replyId) setReplyTo(replyId);
        toast({ title: "Failed to send", description: "Could not send message to this group.", variant: "destructive" });
      }
    } catch {
      if (optimisticId) setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setInputText(text);
      if (replyId) setReplyTo(replyId);
      toast({ title: "Error", description: "Failed to send message.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }, [inputText, sending, relayUrl, group.id, rawEvents, replyTo, toast]);

  const handleDelete = useCallback(async (eventId: string) => {
    try {
      const { ok, error } = await sendDeleteEvent(relayUrl, group.id, eventId);
      if (ok) {
        setDeletedIds((prev) => new Set([...prev, eventId]));
        toast({ title: "Message deleted" });
      } else {
        toast({ title: "Failed", description: error ?? "Could not delete message.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
    setDeleteConfirm(null);
  }, [relayUrl, group.id, toast]);

  const handleRemoveUser = useCallback(async (userPubkey: string) => {
    try {
      const { ok: success, error } = await sendRemoveUser(relayUrl, group.id, userPubkey);
      if (success) {
        // Removal changes the roster the reports queue filters `#p` over.
        notifyNeedsYouChanged();
        toast({ title: "User removed from group" });
      } else {
        toast({ title: "Couldn't remove them", description: error ?? "The relay didn't accept it.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
    setRemoveUserConfirm(null);
  }, [relayUrl, group.id, toast]);

  /**
   * Pin, and CONFIRM it stuck.
   *
   * The relay's OK is not evidence here. `sendGroupPin` publishes a 9002
   * carrying an unknown `pinned` tag, and newlay 0.3.6 was measured returning
   * OK and then dropping the tag — accepted-and-discarded, the same shape as
   * kind-1984 on the same host. `pinnedMessageId` is local state that nothing
   * re-syncs, so the operator saw the banner for the whole session while no
   * member ever did. Pinning the rules is often an operator's first act in a
   * new room, which makes it a poor place to be silently ineffective.
   *
   * So: re-READ the 39000 and believe that, exactly as `applyDoor` does above.
   * A relay that stores the tag behaves identically; one that drops it now says
   * so instead of being congratulated.
   */
  const handlePin = useCallback(async (messageId: string | null) => {
    const prev = pinnedMessageId;
    setPinnedMessageId(messageId); // optimistic
    const { ok, error } = await sendGroupPin(relayUrl, group.id, messageId);
    if (!ok) {
      setPinnedMessageId(prev);
      toast({ title: "Couldn't update pin", description: error ?? "The relay declined the change.", variant: "destructive" });
      return;
    }
    let stored: string | undefined;
    try {
      const fresh = (await fetchGroupMetadata(relayUrl)).find((g) => g.id === group.id);
      if (fresh) { stored = fresh.pinnedMessageId; onGroupMetaChanged?.(fresh); }
    } catch {
      // Accepted but unverifiable. Keep the optimistic value and say nothing
      // more — a failed re-read is not a failed write.
      toast({ title: messageId ? "Message pinned" : "Message unpinned" });
      return;
    }
    const landed = messageId ? stored === messageId : !stored;
    if (landed) {
      toast({ title: messageId ? "Message pinned" : "Message unpinned" });
    } else {
      setPinnedMessageId(stored ?? null);
      toast({
        title: "This relay doesn't keep pinned messages",
        description: "It accepted the change and discarded it, so nobody else would have seen the pin.",
        variant: "destructive",
      });
    }
  }, [relayUrl, group.id, pinnedMessageId, toast, onGroupMetaChanged]);

  const syncNip51GroupList = useCallback(async (action: "add" | "remove") => {
    if (!pubkey) return;
    // Being in a room here makes this relay one of your outposts — which is
    // what puts the community (and now the room) in the Chats list. The
    // documented contract of joinOutpostWithEnrichment is "every add-a-relay
    // action ends up in the unified Your Outposts list", and the room-join
    // path was the one that never called it: a member who followed a room
    // link and knocked was in the room but had no community row anywhere.
    // The invite-signup path (CreateAccountFlow) already does exactly this.
    // localStorage-only and idempotent; deliberately OUTSIDE the blocked
    // gate below, because the membership is a fact the relay granted even
    // when the kind-10009 publish has to be skipped.
    if (action === "add") void joinOutpostWithEnrichment(relayUrl, undefined, pubkey).catch(() => {});
    try {
      // Blocked = we never loaded the real list. Publishing anyway replaces it.
      const base = await loadSimpleGroupsBase(pubkey);
      if (base.blocked) return;
      let updated: SimpleGroupEntry[];
      if (action === "add") {
        const alreadyHas = base.entries.some((e) => e.groupId === group.id && e.relayUrl.replace(/\/+$/, "") === relayUrl.replace(/\/+$/, ""));
        if (alreadyHas) return;
        updated = [...base.entries, { groupId: group.id, relayUrl, name: group.name }];
      } else {
        updated = base.entries.filter((e) => !(e.groupId === group.id && e.relayUrl.replace(/\/+$/, "") === relayUrl.replace(/\/+$/, "")));
      }
      await publishSimpleGroupsList(updated);
    } catch {}
  }, [pubkey, relayUrl, group.id, group.name]);

  useEffect(() => {
    if (isJoined && isInitiallyPending && !isPendingJoin) {
      syncNip51GroupList("add");
    }
  }, [isJoined, isPendingJoin, isInitiallyPending, syncNip51GroupList]);

  const handleJoin = useCallback(async () => {
    setJoining(true);
    try {
      const { ok: success, error } = await sendJoinRequest(relayUrl, group.id, initialInviteCode || undefined);
      if (success) {
        // `!group.isOpen`, NOT `group.isClosed`.
        //
        // These are three states, not two: the relay said open, the relay said
        // closed, or we never learned. Reading the third as "open" put this
        // branch on the wrong side of the only gate in this file that WRITES —
        // it set isJoined, said "Join request sent", and published the room
        // into the member's kind-10009 list, asserting a membership the relay
        // had not granted and might never grant. A stranger knocking on a room
        // whose metadata we could not read was told they were already inside.
        //
        // Treating unknown as closed is the safe direction: the worst case is
        // an accurate "waiting for approval" on a room that would have let them
        // straight in, which the roster fetch corrects on its own.
        if (!group.isOpen) {
          setIsPendingJoin(true);
          onPendingStateChange?.(group.id, true);
          toast({ title: "Request sent", description: "A moderator will review your request." });
        } else {
          setIsJoined(true);
          toast({ title: "Join request sent" });
          syncNip51GroupList("add");
        }
      } else {
        toast({ title: "Couldn't send the request", description: error ?? "The relay didn't accept it.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setJoining(false);
    }
  }, [relayUrl, group.id, group.isOpen, toast, syncNip51GroupList, onPendingStateChange, initialInviteCode]);

  const handleLeave = useCallback(async () => {
    try {
      const { ok: success, error } = await sendLeaveRequest(relayUrl, group.id);
      if (success) {
        setIsJoined(false);
        toast({ title: "Left group" });
        syncNip51GroupList("remove");
      } else {
        // Leaving had NO failure branch at all — the one bug here is silence,
        // not vagueness. A refused leave left `isJoined` true, said nothing,
        // and read as a dead button. sendLeaveRequest also swallows its own
        // throws, so the catch below could never cover it.
        toast({ title: "Couldn't leave", description: error ?? "The relay didn't accept it.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  }, [relayUrl, group.id, toast, syncNip51GroupList]);

  const { emojis: customEmojiList } = useCustomEmojis();

  // Optimistically add/remove the current user's reaction in local state so it
  // shows instantly (top-client UX). The live kind-7 sub dedups the echo by
  // event id + pubkey, so the optimistic entry isn't double-counted.
  const mutateReaction = useCallback((targetId: string, emoji: string, reactor: string, add: boolean, emojiUrl?: string) => {
    if (add && emojiUrl) setReactionEmojiUrls((p) => (p[emoji] ? p : { ...p, [emoji]: emojiUrl }));
    setReactionPubkeys((prev) => {
      const existing = prev[targetId] || {};
      const list = existing[emoji] || [];
      const has = list.includes(reactor);
      if (add ? has : !has) return prev;
      const updated = add ? [...list, reactor] : list.filter((pk) => pk !== reactor);
      setReactionMap((pm) => {
        const ex = { ...(pm[targetId] || {}) };
        if (updated.length > 0) ex[emoji] = updated.length; else delete ex[emoji];
        return { ...pm, [targetId]: ex };
      });
      const nextExisting = { ...existing };
      if (updated.length > 0) nextExisting[emoji] = updated; else delete nextExisting[emoji];
      return { ...prev, [targetId]: nextExisting };
    });
  }, []);

  const handleReact = useCallback(async (eventId: string, emoji: string) => {
    if (!pubkey) return;
    // Session signer (any login method) — NOT window.nostr only, which is
    // undefined for local-key / PWA / bunker users and silently dropped reactions.
    const activeSigner = signer || (window as any).nostr;
    if (!activeSigner) { toast({ title: "Sign in to react", variant: "destructive" }); return; }
    if ((reactionPubkeys[eventId]?.[emoji] || []).includes(pubkey)) return; // already reacted

    const tags: string[][] = [["h", group.id], ["e", eventId, relayUrl]];
    let emojiUrl: string | undefined;
    if (isCustomEmoji(emoji)) {
      const sc = getCustomEmojiShortcode(emoji);
      const url = reactionEmojiUrls[emoji] || customEmojiList.find((e) => e.shortcode === sc)?.url;
      if (sc && url) { tags.push(["emoji", sc, url]); emojiUrl = url; }
    }
    mutateReaction(eventId, emoji, pubkey, true, emojiUrl); // optimistic
    try {
      const eventTemplate = { kind: 7, created_at: Math.floor(Date.now() / 1000), tags, content: emoji };
      const signed = await withSignerTimeout(activeSigner.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
      if (!signed) throw new Error("sign failed");
      const ok = await publishToGroupRelay(relayUrl, signed as NostrEvent);
      if (!ok) throw new Error("publish failed");
    } catch {
      mutateReaction(eventId, emoji, pubkey, false); // rollback
      toast({ title: "Couldn't add reaction", description: "Try again in a moment.", variant: "destructive" });
    }
  }, [pubkey, signer, relayUrl, group.id, reactionEmojiUrls, reactionPubkeys, customEmojiList, mutateReaction, toast]);

  const handleReactCustom = useCallback(async (eventId: string, emoji: CustomEmoji) => {
    if (!pubkey) return;
    const activeSigner = signer || (window as any).nostr;
    if (!activeSigner) { toast({ title: "Sign in to react", variant: "destructive" }); return; }
    const content = `:${emoji.shortcode}:`;
    if ((reactionPubkeys[eventId]?.[content] || []).includes(pubkey)) return;
    mutateReaction(eventId, content, pubkey, true, emoji.url); // optimistic
    try {
      const eventTemplate = {
        kind: 7,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["h", group.id], ["e", eventId, relayUrl], ["emoji", emoji.shortcode, emoji.url]],
        content };
      const signed = await withSignerTimeout(activeSigner.signEvent(eventTemplate), SIGNER_SIGN_TIMEOUT, "signEvent");
      if (!signed) throw new Error("sign failed");
      const ok = await publishToGroupRelay(relayUrl, signed as NostrEvent);
      if (!ok) throw new Error("publish failed");
    } catch {
      mutateReaction(eventId, content, pubkey, false); // rollback
      toast({ title: "Couldn't add reaction", description: "Try again in a moment.", variant: "destructive" });
    }
  }, [pubkey, signer, relayUrl, group.id, reactionPubkeys, mutateReaction, toast]);

  const handleMediaUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadMedia(file, undefined, signer || (window as any).nostr || null);
      if (result?.url) {
        setInputText((prev) => (prev ? prev + "\n" + result.url : result.url));
        toast({ title: "Media uploaded" });
      }
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [toast]);

  return (
    // h-full fills the ChannelRoomFrame overlay (a fixed, body-portaled panel
    // sized to the visual viewport — same full-height contract as Messages /
    // ConcordChat). min-h-0 lets the scrolling message list shrink instead of
    // pushing the pinned composer off-screen.
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 px-3 py-2.5 border-b border-border/40 bg-muted/20 dark:bg-white/[0.02] shrink-0">
        <button onClick={onBack} className="p-2 rounded-md hover:bg-muted/60 text-muted-foreground/70 hover:text-foreground shrink-0" aria-label="Back">
          <ArrowLeft className="w-[18px] h-[18px]" />
        </button>
        {group.picture ? (
          <Avatar className="w-7 h-7 shrink-0">
            <AvatarImage src={group.picture} alt={group.name || group.id} />
            <AvatarFallback className="text-[8px] bg-primary/10"><Hash className="w-3 h-3" /></AvatarFallback>
          </Avatar>
        ) : (
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Hash className="w-3.5 h-3.5 text-brand/70" />
          </div>
        )}
        <div className="flex-1 min-w-0 basis-0">
          <span className="text-sm font-semibold text-foreground/90 truncate block leading-tight">
            {group.name || group.id}
          </span>
          {group.isPrivate && (
            <span className="text-[10px] text-muted-foreground/50">Private</span>
          )}
        </div>
        <div className="flex items-center gap-0.5 ml-auto shrink-0">
          {onTogglePin && (
            <button
              onClick={onTogglePin}
              className={`p-2 rounded-md transition-colors ${(isPinned || isQuickAccessPinned) ? "text-brand hover:bg-brand/10" : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/60"}`}
              title={(isPinned || isQuickAccessPinned) ? "Unpin (top of list + sidebar)" : "Pin (top of list + sidebar)"}
              aria-label={(isPinned || isQuickAccessPinned) ? "Unpin" : "Pin"}
            >
              <Pin className={`w-[18px] h-[18px] ${(isPinned || isQuickAccessPinned) ? "fill-current" : ""}`} />
            </button>
          )}
          <button
            onClick={() => { fetchProfilesCached(members); setShowMembersPanel(true); }}
            className="p-2 rounded-md hover:bg-muted/60 text-muted-foreground/70 hover:text-foreground flex items-center gap-1"
            title="Members"
            aria-label="Members"
          >
            <Users className="w-[18px] h-[18px]" />
            {members.length > 0 && <span className="text-[11px] font-medium">{members.length}</span>}
          </button>
          <button
            onClick={() => { setInviteCopied(false); setLinkCopied(false); setInviteRecipient(null); setShowInvitePanel(true); }}
            className="p-2 rounded-md hover:bg-muted/60 text-muted-foreground/70 hover:text-foreground"
            title="Invite people"
            aria-label="Invite people"
            data-testid="button-invite-chat"
          >
            <Link2 className="w-[18px] h-[18px]" />
          </button>
          {/* THE ADMIN DOOR — one of them, and it has a word on it.
              This block was the ⋯ menu PLUS three icon-only buttons (gear,
              join-requests, add-member) that the Manage drawer already covers
              1:1 in plain English, each drawer link opening the very same panel
              two taps later. The comment that stood here said they were "a
              second, complete way in, not yet a replacement — retiring these is
              its own change, once this one has been watched working." It has
              been watched working, so this is that change.

              What a newcomer met before: eight icon-only controls in a row, two
              of them ADJACENT UserPlus glyphs doing different things,
              distinguished only by a `title` — which never fires on touch. The
              single labelled item, "Mod", was `hidden sm:flex`, so a phone
              showed eight glyphs and no words at all.

              MEMBERS SEE NO CHANGE: all three removed controls were already
              gated on isOwner/isMod, so a plain member's header is identical.
              "Mod" goes with them — a button reading Manage says the same thing
              and does something. */}
          {hasAnyCapability(caps) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAdminOpen(true)}
              className="h-8 px-2.5 text-xs gap-1.5 text-brand hover:bg-brand/10"
              data-testid="button-manage-room"
            >
              <Shield className="w-3.5 h-3.5" />
              Manage
              {/* The waiting count rides the door it belongs to. It used to sit
                  on the ⋯ glyph, where a floating "2" named nothing. */}
              {isMod && !group.isOpen && filteredRequests.length > 0 && (
                <span className="min-w-4 h-4 px-1 rounded-full bg-amber-500 text-white text-[9px] inline-flex items-center justify-center font-bold">
                  {filteredRequests.length}
                </span>
              )}
            </Button>
          )}
          <SpaceOverflowMenu
            triggerClassName="p-2 rounded-md hover:bg-muted/60 text-muted-foreground/70 hover:text-foreground"
            triggerIconClassName="w-[18px] h-[18px]"
            triggerTestId="nip29-space-menu"
            // Manage is its own labelled button now, so the ⋯ carries only what
            // is genuinely member-level. Passing it here too would rebuild the
            // duplication this change exists to remove.
            onManage={undefined}
            attention={0}
            petnameSubject={{ kind: "community", id: relayUrl, realName: relayUrl.replace(/^wss?:\/\//, "") }}
            isOwner={false}
          />
          {isJoined ? (
            <Button size="sm" variant="ghost" onClick={handleLeave} className="h-8 px-2.5 text-xs text-red-600/70 dark:text-red-400/70 hover:text-red-500 hover:bg-red-500/10 gap-1.5">
              <LogOut className="w-3.5 h-3.5" />
              Leave
            </Button>
          ) : isPendingJoin ? (
            <span className="h-8 flex items-center text-xs text-amber-600/70 dark:text-amber-400/70 gap-1.5 px-1.5">
              <Clock className="w-3.5 h-3.5" />
              Requested
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={handleJoin} disabled={joining} className="h-8 px-3 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 gap-1.5">
              <LogIn className="w-3.5 h-3.5" />
              {joining ? "Joining…" : "Join"}
            </Button>
          )}
        </div>
      </div>

      {pinnedMessageId && (() => {
        const pinnedMsg = messages.find((m) => m.id === pinnedMessageId);
        if (!pinnedMsg) return null;
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-primary/15 bg-primary/[0.06] shrink-0" data-testid="pinned-banner">
            <Pin className="w-3 h-3 text-brand fill-current shrink-0" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-brand shrink-0">Pinned</span>
            <button
              onClick={() => document.querySelector(`[data-testid="chat-msg-${pinnedMessageId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className="text-[11px] text-muted-foreground/70 truncate flex-1 text-left hover:text-foreground transition-colors"
            >
              {pinnedMsg.content || "(media)"}
            </button>
            {isMod && (
              <button onClick={() => handlePin(null)} className="text-[10px] text-muted-foreground/50 hover:text-red-500 shrink-0 px-1" title="Unpin">Unpin</button>
            )}
          </div>
        );
      })()}

      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden space-y-0.5 py-2"
        style={{ minHeight: 0 }}
      >
        {loading && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[120px] gap-3">
            <RelayOutpostInlineLoader className="w-6 h-6" />
            <p className="text-xs text-muted-foreground/50">Loading messages…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[120px] gap-2">
            <MessageSquare className="w-8 h-8 text-muted-foreground/20" />
            <p className="text-xs text-muted-foreground/50">No messages yet</p>
            <p className="text-[10px] text-muted-foreground/30">Be the first to say something</p>
          </div>
        ) : (
          displayRows.map((row) => {
            if (row.kind === "trust-collapsed") {
              const n = row.items.length;
              return (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => revealTrustRun(row.runKey)}
                  data-testid="chat-trust-hidden-divider"
                  className="group/trust w-full min-h-[44px] my-1.5 flex items-center gap-2 px-1 text-left rounded-md hover:bg-muted/40 active:bg-accent/60 transition-colors"
                  aria-label={`${n} ${n === 1 ? "message" : "messages"} hidden by your trust filter — tap to show`}
                >
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap group-hover/trust:text-foreground/70">
                    {n} {n === 1 ? "message" : "messages"} hidden by your trust filter — tap to show
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </button>
              );
            }
            const item = row.item;
            if (item.type === "date") {
              return (
                <div key={item.key} className="dm-date-separator my-2">
                  <span className="text-[10px] font-medium text-muted-foreground/60 whitespace-nowrap">{item.label}</span>
                </div>
              );
            }
            if (item.type === "unread") {
              return (
                <div key={item.key} className="flex items-center gap-2 my-2" data-testid="chat-unread-divider">
                  <div className="flex-1 h-px bg-primary/30" />
                  <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-brand">New</span>
                  <div className="flex-1 h-px bg-primary/30" />
                </div>
              );
            }
            if (item.type === "system-group") {
              return <ChatSystemGroupLine key={item.key} joins={item.joins} leaves={item.leaves} />;
            }
            const msg = item.msg;
            return (
              <ChatMessageBubble
                key={item.key}
                msg={msg}
                isMine={item.isMine}
                isClusterStart={item.isClusterStart}
                isClusterEnd={item.isClusterEnd}
                delivered={!!deliveredIds[msg.id]}
                isMod={isMod}
                isDeleted={deletedIds.has(msg.id)}
                replyToDeleted={msg.replyTo ? deletedIds.has(msg.replyTo) : false}
                isRemovedUser={removedUsers.has(msg.pubkey)}
                reactions={reactionMap[msg.id]}
                reactionPubkeys={reactionPubkeys[msg.id]}
                reactionEmojiUrls={reactionEmojiUrls}
                customEmojis={customEmojiList}
                allMessages={messages}
                onDelete={(id) => setDeleteConfirm(id)}
                onRemoveUser={(pk) => setRemoveUserConfirm(pk)}
                onReply={canCompose ? (id) => {
                  setReplyTo(id);
                  requestAnimationFrame(() => {
                    inputRef.current?.focus();
                    inputRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                  });
                } : undefined}
                onReact={pubkey ? handleReact : undefined}
                onReactCustom={pubkey ? handleReactCustom : undefined}
                mentionsMe={!!pubkey && msg.pubkey !== pubkey && msg.tags.some((t) => t[0] === "p" && t[1] === pubkey)}
                onPin={isMod ? handlePin : undefined}
                isPinnedMsg={pinnedMessageId === msg.id}
              />
            );
          })
        )}
      </div>

      {canCompose && (
        <div className="shrink-0 border-t border-border/30 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {replyTo && (() => {
            const repliedMsg = messages.find((m) => m.id === replyTo);
            return (
              <div className="flex items-center gap-2 mb-1.5 rounded-md border-l-2 border-brand/40 bg-brand/[0.06]/[0.08] px-2.5 py-1.5">
                <div className="flex-1 min-w-0">
                  <ReplyPreviewAuthor pubkey={deletedIds.has(replyTo) ? undefined : repliedMsg?.pubkey} />
                  <p className="text-[10px] text-muted-foreground/60 truncate mt-0.5 leading-snug">
                    {deletedIds.has(replyTo)
                      ? "Message deleted by moderator"
                      : repliedMsg?.content
                        ? repliedMsg.content.length > 80 ? repliedMsg.content.slice(0, 80) + "…" : repliedMsg.content
                        : "Message not found"}
                  </p>
                </div>
                <button onClick={() => setReplyTo(null)} className="p-0.5 hover:bg-muted/50 rounded shrink-0">
                  <X className="w-3 h-3 text-muted-foreground/50" />
                </button>
              </div>
            );
          })()}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={handleMediaUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="h-11 w-11 sm:h-8 sm:w-8 inline-flex items-center justify-center rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-muted-foreground shrink-0"
              title="Upload media"
              aria-label="Upload media"
            >
              {uploading ? <RelayOutpostInlineLoader className="w-4 h-4" /> : <ImagePlus className="w-4 h-4" />}
            </button>
            <div className="relative shrink-0">
              <button
                ref={composeEmojiTriggerRef}
                onClick={() => setShowComposeEmoji((prev) => !prev)}
                className="h-11 w-11 sm:h-8 sm:w-8 inline-flex items-center justify-center rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-muted-foreground"
                title="Insert emoji"
                aria-label="Insert emoji"
              >
                <Smile className="w-4 h-4" />
              </button>
              {showComposeEmoji && (
                <div
                  ref={composeEmojiRef}
                  className="absolute bottom-full left-0 mb-1 z-50 grid grid-cols-5 gap-0.5 bg-background/95 backdrop-blur border border-border/30 rounded-lg p-2 shadow-lg w-[200px] sm:w-[180px]"
                >
                  {COMPOSE_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={(e) => {
                        e.stopPropagation();
                        setInputText((prev) => prev + emoji);
                        setShowComposeEmoji(false);
                        inputRef.current?.focus();
                      }}
                      className="p-1.5 rounded hover:bg-muted/50 active:bg-muted/70 text-lg sm:text-base text-center transition-transform hover:scale-110 active:scale-95"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Textarea
              ref={inputRef}
              value={inputText}
              rows={1}
              onChange={(e) => setInputText(e.target.value)}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Message"
              className="flex-1 min-w-0 min-h-10 sm:min-h-9 max-h-[120px] resize-none rounded-2xl px-4 py-2 text-base sm:text-sm leading-snug bg-muted/30 border-border/30 focus-visible:ring-ring"
              disabled={sending}
            />
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!inputText.trim() || sending}
              className="h-11 w-11 sm:h-9 sm:w-9 p-0 shrink-0 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {pubkey && !isJoined && group.isRestricted && rosterReached === false ? (
        // We could not open a socket, so we do not know whether they are a
        // member. Saying "requires membership" here — with a Join button — told
        // people already in the room that they weren't.
        <div className="border-t border-border/30 px-3 py-3 text-center">
          <p className="text-xs text-muted-foreground/50">
            Can't reach this group's relay, so we can't check your membership. Try again in a moment.
          </p>
        </div>
      ) : null}

      {pubkey && !isJoined && group.isRestricted && rosterReached !== false && (
        <div className="border-t border-border/30 px-3 py-3 text-center">
          {isPendingJoin ? (
            <>
              <p className="text-xs text-amber-600/70 dark:text-amber-400/70 mb-1">Join request pending</p>
              <p className="text-[10px] text-muted-foreground/40">An admin will review your request</p>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground/50 mb-2">This group requires membership to post</p>
              <Button size="sm" onClick={handleJoin} disabled={joining} className="gap-1 text-xs bg-primary hover:bg-primary/90 text-primary-foreground">
                <LogIn className="w-3 h-3" />
                {joining ? "Joining…" : "Join Group"}
              </Button>
            </>
          )}
        </div>
      )}

      {!pubkey && (
        <div className="border-t border-border/30 px-3 py-3 text-center">
          <p className="text-xs text-muted-foreground/50">Sign in to participate in this chat</p>
        </div>
      )}

      <ResponsiveFormPanel
        open={!!deleteConfirm}
        onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}
        contentClassName="border-red-500/20"
        title="Delete Message?"
        description="This will remove the message from the group chat."
        scrollBody={false}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirm(null)}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (deleteConfirm) {
                  const id = deleteConfirm;
                  setDeleteConfirm(null);
                  handleDelete(id);
                }
              }}
              className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Delete
            </Button>
          </div>
        }
      >
        <div />
      </ResponsiveFormPanel>

      <ResponsiveFormPanel
        open={!!removeUserConfirm}
        onOpenChange={(open) => { if (!open) setRemoveUserConfirm(null); }}
        contentClassName="border-red-500/20"
        title="Remove User?"
        description="This will remove the user from this group. They can request to rejoin."
        scrollBody={false}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setRemoveUserConfirm(null)}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (removeUserConfirm) {
                  const pk = removeUserConfirm;
                  setRemoveUserConfirm(null);
                  handleRemoveUser(pk);
                }
              }}
              className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
            >
              <UserMinus className="w-3 h-3 mr-1" />
              Remove
            </Button>
          </div>
        }
      >
        <div />
      </ResponsiveFormPanel>

      <ResponsiveFormPanel
        open={showRequestsPanel}
        onOpenChange={setShowRequestsPanel}
        contentClassName="border-amber-500/20"
        title={
          <>
            <UserPlus className="w-4 h-4 text-amber-500" />
            Join Requests
            {filteredRequests.length > 0 && (
              <span className="text-[10px] bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full">
                {filteredRequests.length}
              </span>
            )}
          </>
        }
        description="People asking to join this room."
        footer={
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => setShowRequestsPanel(false)}
              className="h-8 text-xs"
            >
              Close
            </Button>
          </div>
        }
      >
        <div className="space-y-0.5 -mx-2 px-2">
          {filteredRequests.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <UserPlus className="w-6 h-6 text-muted-foreground/20" />
              <p className="text-xs text-muted-foreground/50">No pending requests</p>
            </div>
          ) : (
            filteredRequests.map((req) => (
              <JoinRequestRow
                key={req.eventId}
                req={req}
                onApprove={handleApproveRequest}
                onDismiss={handleDismissRequest}
                approving={approvingPubkey === req.pubkey}
              />
            ))
          )}
        </div>
      </ResponsiveFormPanel>

      <ResponsiveFormPanel
        open={showMembersPanel}
        onOpenChange={setShowMembersPanel}
        contentClassName="border-primary/20"
        title={
          <>
            <Users className="w-4 h-4 text-brand" />
            Members
            {members.length > 0 && (
              <span className="text-[10px] bg-brand/20 text-brand px-1.5 py-0.5 rounded-full">
                {members.length}
              </span>
            )}
          </>
        }
        footer={
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => setShowMembersPanel(false)}
              className="h-8 text-xs"
            >
              Close
            </Button>
          </div>
        }
      >
        <div className="space-y-0.5 -mx-2 px-2">
          {admins.length > 0 && (
            <div className="mb-1">
              <span className="text-[9px] font-medium uppercase tracking-wider text-brand/60 px-2">Admins</span>
              {admins.map((a) => (
                <MemberRow
                  key={a.pubkey}
                  memberPubkey={a.pubkey}
                  isAdmin={true}
                  canRemove={false}
                />
              ))}
            </div>
          )}
          {members.filter((m) => !admins.some((a) => a.pubkey === m)).length > 0 && (
            <div>
              <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/40 px-2">Members</span>
              {members
                .filter((m) => !admins.some((a) => a.pubkey === m))
                .map((m) => (
                  <MemberRow
                    key={m}
                    memberPubkey={m}
                    isAdmin={false}
                    canRemove={isMod}
                    onRemove={(pk) => setRemoveUserConfirm(pk)}
                  />
                ))}
            </div>
          )}
          {members.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Users className="w-6 h-6 text-muted-foreground/20" />
              <p className="text-xs text-muted-foreground/50">
                {rosterReached === false
                  ? "Couldn't load who's here. Try again in a moment."
                  : "No members yet"}
              </p>
            </div>
          )}
        </div>
      </ResponsiveFormPanel>

      <Nip29AdminDrawer
        open={adminOpen}
        onOpenChange={setAdminOpen}
        caps={caps}
        ready={adminsLoaded}
        relayUrl={relayUrl}
        groupId={group.id}
        groupName={group.name || group.id}
        groupPicture={group.picture}
        // Derived ONCE here and passed down, so the drawer's summary and the
        // settings panel's switches cannot disagree about the same room.
        join={door.join}
        read={door.read}
        isRestricted={!!group.isRestricted}
        pendingCount={filteredRequests.length}
        memberCount={members.length}
        about={group.about}
        onOpenRequests={() => { setAdminOpen(false); setShowRequestsPanel(true); }}
        onOpenMembers={() => { setAdminOpen(false); setShowMembersPanel(true); }}
        onAddMember={() => { setAdminOpen(false); setShowAddMember(true); }}
        onOpenSettings={() => { setAdminOpen(false); setEditName(group.name || ""); setEditAbout(group.about || ""); setEditPicture(null); setConfirmDelete(false); setShowSettings(true); }}
        onDelete={() => { setAdminOpen(false); setConfirmDelete(true); }}
      />
      <AddMemberSheet
        open={showAddMember}
        onOpenChange={setShowAddMember}
        relayUrl={relayUrl}
        groupId={group.id}
        onAdded={() => {
          // Members list refresh is driven by the existing group subscriptions in CommsTab.
        }}
      />

      <ResponsiveFormPanel
        open={showInvitePanel}
        onOpenChange={setShowInvitePanel}
        contentClassName="border-primary/20 sm:max-h-[calc(100dvh-4rem)]"
        title={
          <>
            <Link2 className="w-4 h-4 text-brand" />
            Invite to {group.name || "this room"}
          </>
        }
        description="Share a link, or send a private invite DM."
        footer={
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => setShowInvitePanel(false)}
              className="h-8 text-xs"
            >
              Close
            </Button>
          </div>
        }
      >
        <div className="space-y-4 py-2">
          {/* Closed channels: an invite code makes the link auto-approve joins.
              `!isOpen` rather than `isClosed` because this is a TOOL, not a
              claim: hiding it on unreadable metadata denies a genuine owner
              their invite code, while showing it on a room that turns out to be
              open is a harmless no-op. */}
          {isOwner && !group.isOpen && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50">Invite code · auto-approves joins</p>
              {inviteCode ? (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/20 border border-border/30">
                  <code className="flex-1 text-xs font-mono text-foreground/90 select-all truncate">{inviteCode}</code>
                  <Button size="sm" variant="ghost" onClick={handleCopyInvite} className="h-7 px-2 gap-1 text-[10px] shrink-0">
                    {inviteCopied ? <><Check className="w-3 h-3 text-emerald-500" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                  </Button>
                </div>
              ) : (
                <Button onClick={handleGenerateInvite} disabled={generatingInvite} variant="outline" className="w-full text-xs gap-1.5 h-9">
                  {generatingInvite ? <><RelayOutpostInlineLoader className="w-3 h-3" /> Generating…</> : <><Ticket className="w-3 h-3" /> Generate invite code</>}
                </Button>
              )}
            </div>
          )}

          {/* Shareable link */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50">Invite link</p>
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/20 border border-border/30">
              <Link2 className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
              <span className="flex-1 text-[11px] font-mono text-foreground/70 truncate">{buildChannelInviteLink(relayUrl, group.id, inviteCode || undefined, pubkey ? formatNpub(pubkey) : undefined)}</span>
              <Button size="sm" variant="ghost" onClick={handleCopyLink} className="h-7 px-2 gap-1 text-[10px] shrink-0" data-testid="button-copy-invite-link">
                {linkCopied ? <><Check className="w-3 h-3 text-emerald-500" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground/40">Anyone with the link can open the room and tap Join.</p>
          </div>

          {/* Send a private invite DM */}
          {pubkey && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50">Send to a person · private DM</p>
              <ProfileSearchInput
                onSelect={(r) => setInviteRecipient(r)}
                selected={inviteRecipient}
                placeholder="Search a name, or paste a key…"
              />
              <Button
                onClick={handleSendInviteDM}
                disabled={!inviteRecipient?.pubkey || sendingInvite}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs gap-1.5 h-9 disabled:opacity-50"
                data-testid="button-send-invite-dm"
              >
                {sendingInvite ? <><RelayOutpostInlineLoader className="w-3 h-3" /> Sending…</> : <><Send className="w-3 h-3" /> Send invite DM</>}
              </Button>
            </div>
          )}
        </div>
      </ResponsiveFormPanel>

      {/* Channel settings (owner) */}
      <ResponsiveFormPanel
        open={showSettings}
        onOpenChange={setShowSettings}
        contentClassName="border-primary/20 sm:max-h-[calc(100dvh-4rem)]"
        title={<><Settings className="w-4 h-4 text-brand" /> Room settings</>}
        description="Edit this room or delete it."
        footer={
          <div className="flex items-center justify-between gap-2 w-full">
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="h-8 text-xs text-red-600/70 dark:text-red-400/70 hover:text-red-500 gap-1.5" data-testid="button-delete-channel">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
            <Button onClick={handleSaveSettings} disabled={!editName.trim() || savingSettings} className="h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5 disabled:opacity-50" data-testid="button-save-channel-settings">
              {savingSettings ? <><RelayOutpostInlineLoader className="w-3 h-3" /> Saving…</> : "Save changes"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-1.5 block">Name</Label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Room name"
              className="w-full h-10 px-3 text-sm rounded-lg bg-white/[0.03] border border-border/30 focus:border-primary/40 focus:outline-none"
              data-testid="input-edit-channel-name"
            />
          </div>
          <div>
            <Label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-1.5 block">Description</Label>
            <Textarea
              value={editAbout}
              onChange={(e) => setEditAbout(e.target.value)}
              placeholder="What's this room about?"
              className="text-sm bg-white/[0.03] border-border/30 focus:border-primary/40 min-h-[64px]"
              data-testid="input-edit-channel-about"
            />
          </div>
          {/* WHO CAN GET IN — two axes, each with its own switch, each firing
              on toggle. Kept visually apart from the name/description fields
              above because "Save changes" does NOT apply them: a door is a
              different decision from a rename and must not ride a form button
              that people press to fix a typo. */}
          <div className="pt-1 border-t border-border/20">
            <Label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-2 block">Who can get in</Label>
            {door.join === "unknown" || door.read === "unknown" ? (
              // Never offer a switch whose current position we cannot read —
              // the first click would be a guess published as an instruction.
              <p className="text-[11px] text-muted-foreground/60">
                We couldn't read this room's access settings, so they can't be changed from here.
              </p>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-foreground/90">Let people in one at a time</p>
                    <p className="text-[11px] text-muted-foreground/60">
                      {door.join === "closed" ? "People ask, and a moderator lets them in." : "Anyone can join without asking."}
                    </p>
                  </div>
                  <Switch
                    checked={door.join === "closed"}
                    disabled={savingDoor}
                    onCheckedChange={(v) => applyDoor({ isPrivate: door.read === "private", isClosed: v })}
                    data-testid="switch-group-closed"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-foreground/90">Members only</p>
                    <p className="text-[11px] text-muted-foreground/60">
                      {door.read === "private" ? "Only members can read what's posted." : "Anyone can read what's posted."}
                    </p>
                  </div>
                  <Switch
                    checked={door.read === "private"}
                    disabled={savingDoor}
                    onCheckedChange={(v) => applyDoor({ isPrivate: v, isClosed: door.join === "closed" })}
                    data-testid="switch-group-private"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground/50">
                  The relay enforces this and may decline. Changes apply immediately.
                </p>
              </div>
            )}
          </div>
          <div>
            <Label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-1.5 block">Image</Label>
            <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground/70 hover:text-foreground transition-colors">
              <span className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-white/[0.03] border border-border/30">
                <ImagePlus className="w-3.5 h-3.5" />
                {editPicture ? editPicture.name.slice(0, 24) : "Choose image"}
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => setEditPicture(e.target.files?.[0] || null)} />
            </label>
          </div>
        </div>
      </ResponsiveFormPanel>

      {/* Delete confirm */}
      <ResponsiveFormPanel
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        contentClassName="border-red-500/30"
        title={<><Trash2 className="w-4 h-4 text-red-500" /> Delete room?</>}
        description={`"${group.name || group.id}" will be removed. This can't be undone.`}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button variant="outline" onClick={() => setConfirmDelete(false)} className="h-8 text-xs">Cancel</Button>
            <Button onClick={handleDeleteChannel} disabled={deleting} className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white gap-1.5" data-testid="button-confirm-delete-channel">
              {deleting ? <><RelayOutpostInlineLoader className="w-3 h-3" /> Deleting…</> : <><Trash2 className="w-3.5 h-3.5" /> Delete</>}
            </Button>
          </div>
        }
      >
        <div className="py-2 text-xs text-muted-foreground/60">
          Members will lose access. The relay processes the deletion (kind 9008); if it
          declines, the channel may persist.
        </div>
      </ResponsiveFormPanel>
    </div>
  );
}

function RoomList({
  relayUrl,
  visibleRooms,
  pinnedIds,
  quickAccessPinnedIds,
  activeFilter,
  activityMap,
  isGroupJoined,
  isGroupPending,
  joiningGroupId,
  pubkey,
  hasMore,
  remainingCount,
  onSelect,
  onJoin,
  onLeave,
  onTogglePin,
  onToggleQuickAccessPin,
  onShowMore }: {
  /** Read marks are relay-scoped — a group id alone is only unique per relay. */
  relayUrl: string;
  visibleRooms: GroupMetadata[];
  pinnedIds: Set<string>;
  quickAccessPinnedIds?: Set<string>;
  activeFilter: RoomFilter;
  activityMap: Record<string, number>;
  isGroupJoined: (gid: string) => boolean;
  isGroupPending: (gid: string) => boolean;
  joiningGroupId: string | null;
  pubkey: string | null | undefined;
  hasMore: boolean;
  remainingCount: number;
  onSelect: (g: GroupMetadata) => void;
  onJoin: (gid: string, name?: string) => void;
  onLeave: (gid: string) => void;
  onTogglePin: (gid: string, name: string) => void;
  onToggleQuickAccessPin?: (gid: string, name: string) => void;
  onShowMore: () => void;
}) {
  const pinnedVisible = visibleRooms.filter((g) => pinnedIds.has(g.id));
  const unpinnedVisible = activeFilter !== "pinned" ? visibleRooms.filter((g) => !pinnedIds.has(g.id)) : [];

  const renderCard = (g: GroupMetadata) => (
    <GroupCard
      key={g.id}
      group={g}
      isJoined={isGroupJoined(g.id)}
      isPending={isGroupPending(g.id)}
      isPinned={pinnedIds.has(g.id)}
      isQuickAccessPinned={quickAccessPinnedIds?.has(g.id)}
      lastActivity={activityMap[g.id]}
      unread={(activityMap[g.id] ?? 0) > readChannelLastRead(relayUrl, g.id)}
      onSelect={() => onSelect(g)}
      onJoin={pubkey ? () => onJoin(g.id, g.name) : undefined}
      onLeave={pubkey ? () => onLeave(g.id) : undefined}
      onTogglePin={() => onTogglePin(g.id, g.name || g.id)}
      joining={joiningGroupId === g.id}
    />
  );

  return (
    <div className="space-y-2">
      {pinnedVisible.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 pt-1">
            <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">Pinned</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {pinnedVisible.map(renderCard)}
          </div>
          {unpinnedVisible.length > 0 && (
            <div className="border-t border-border/20 my-1" />
          )}
        </>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {unpinnedVisible.map(renderCard)}
      </div>
      {hasMore && (
        <button
          onClick={onShowMore}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-border/30 text-[11px] text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/20 transition-colors"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          Show more ({remainingCount} remaining)
        </button>
      )}
    </div>
  );
}

/**
 * Frame that turns an open channel into a locked, native chat room: full-screen
 * on mobile, and on desktop a focused pane filling the content area to the right
 * of the sidebar. Only the message list inside scrolls; the page never does.
 */
function ChannelRoomFrame({ children }: { children: React.ReactNode }) {
  const { state, isMobile } = useSidebar();
  // Ride the visual viewport so the composer docks just above the keyboard
  // (native feel) instead of hiding behind it. Active only on mobile; the frame
  // only mounts while a room is open.
  const kb = useKeyboardViewport(isMobile);
  // The room is position:fixed, but an ancestor (PullToRefresh) sets a transform
  // that would make "fixed" relative to the content column instead of the
  // viewport. Portal to <body> to escape that, and measure the content area's
  // left edge so desktop keeps the sidebar while mobile goes truly full-screen.
  const [leftPx, setLeftPx] = useState(0);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const main = document.querySelector("main");
    const measure = () => {
      if (isMobile || !main) { setLeftPx(0); return; }
      setLeftPx(Math.max(0, Math.round(main.getBoundingClientRect().left)));
    };
    measure();
    let ro: ResizeObserver | undefined;
    if (main && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(main);
    }
    window.addEventListener("resize", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, [isMobile, state]);

  const panel = (
    <div
      className="fixed inset-y-0 right-0 z-[60] flex flex-col bg-background animate-in fade-in-0 duration-150"
      style={kb.height != null ? { left: leftPx, height: `${kb.height}px`, top: `${kb.offsetTop}px`, bottom: "auto" } : { left: leftPx }}
      data-testid="channel-room-frame"
    >
      {children}
    </div>
  );
  return typeof document !== "undefined" ? createPortal(panel, document.body) : panel;
}

export function CommsTab({
  relayUrl,
  createChannelOpen,
  onCreateChannelClose,
  supportedNips,
  initialChannelId,
  initialInviteCode,
  onQuickAccessPin,
  quickAccessPinnedIds,
  trustFilterEnabled,
  isHiddenByTrust,
  onTrustHidden }: {
  relayUrl: string;
  createChannelOpen?: boolean;
  onCreateChannelClose?: () => void;
  supportedNips?: number[];
  initialChannelId?: string;
  initialInviteCode?: string;
  onQuickAccessPin?: (groupId: string, groupName: string) => void;
  quickAccessPinnedIds?: Set<string>;
  trustFilterEnabled?: boolean;
  isHiddenByTrust?: (pubkey: string) => boolean;
  onTrustHidden?: (count: number) => void;
}) {
  const { pubkey, signer } = useNostrAuth();
  const [groups, setGroups] = useState<GroupMetadata[]>([]);
  // null until the first fetch settles. False = the relay never answered, which
  // is NOT a statement about how many rooms it has.
  const [relayReached, setRelayReached] = useState<boolean | null>(null);
  // Set when the socket opened and the relay then declined our sign-in. A
  // THIRD outcome: `relayReached` is true, and the empty list still isn't an
  // answer. Carries the relay's own words.
  const [relayRefused, setRelayRefused] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [joinedGroupIds, setJoinedGroupIds] = useState<Set<string>>(new Set());
  const [joiningGroupId, setJoiningGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<GroupMetadata | null>(null);
  const [resolvingInviteChannel, setResolvingInviteChannel] = useState(false);
  const { toast } = useToast();

  const [pendingGroupIds, setPendingGroupIds] = useState<Set<string>>(new Set());
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelAbout, setNewChannelAbout] = useState("");
  const [newChannelClosed, setNewChannelClosed] = useState(false);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [creatingQuietRoom, setCreatingQuietRoom] = useState(false);
  const [newChannelPicture, setNewChannelPicture] = useState<File | null>(null);
  const [newChannelPicturePreview, setNewChannelPicturePreview] = useState<string | null>(null);
  const channelPicInputRef = useRef<HTMLInputElement>(null);
  const [autoOpenAddMemberForGroup, setAutoOpenAddMemberForGroup] = useState<string | null>(null);

  const hasNip29 = mayHostNip29(supportedNips);

  useEffect(() => {
    if (createChannelOpen) setShowCreateChannel(true);
  }, [createChannelOpen]);

  const resetCreateForm = useCallback(() => {
    setNewChannelName("");
    setNewChannelAbout("");
    setNewChannelClosed(false);
    setNewChannelPicture(null);
    if (newChannelPicturePreview) URL.revokeObjectURL(newChannelPicturePreview);
    setNewChannelPicturePreview(null);
    setShowCreateChannel(false);
    onCreateChannelClose?.();
  }, [onCreateChannelClose, newChannelPicturePreview]);

  const createGroupFlow = useCallback(async (opts: {
    name: string;
    about?: string;
    isPrivate?: boolean;
    isClosed?: boolean;
    picture?: File | null;
    autoOpenAddMember?: boolean;
    successTitle?: string;
    successDescription?: string;
  }) => {
    const name = opts.name.trim();
    if (!name || !pubkey) return false;
    try {
      const groupId = deriveGroupId(name);
      const { ok, error } = await sendCreateGroup(relayUrl, {
        groupId,
        name,
        about: opts.about?.trim() || undefined,
        isPrivate: opts.isPrivate || undefined,
        isClosed: opts.isClosed || undefined });
      if (!ok) {
        // Prefer what the relay actually said. The old guess — "it may not
        // support NIP-29 groups" — was wrong for every relay that supports them
        // perfectly well and simply declined THIS request, which is most of them.
        const reason = error
          ?? (!hasNip29
            ? "This server can't host rooms."
            : "The relay turned down the new room.");
        toast({ title: "Creation failed", description: reason, variant: "destructive" });
        return false;
      }
      markGroupCreated(relayUrl, groupId);
      // The THIRD add-a-relay site, found live: creating a room publishes the
      // kind-10009 below but never joined the outpost, so a creator's own
      // community was missing from Your Outposts and existed in Chats only via
      // the synthesized orphan parent. Same contract as the join path in
      // syncNip51GroupList; grep for joinOutpostWithEnrichment before adding a
      // fourth spelling of "this account now has rooms here".
      void joinOutpostWithEnrichment(relayUrl, undefined, pubkey).catch(() => {});
      toast({
        title: opts.successTitle ?? "Room created",
        description: opts.successDescription ?? `"${name}" is now live.`,
      });

      const createUploadSigner = signer || (window as any).nostr;
      if (opts.picture && createUploadSigner) {
        try {
          const result = await uploadMedia(opts.picture, undefined, createUploadSigner);
          if (result?.url) {
            // The channel already exists and the success toast has fired, so a
            // refused picture is not a failed creation — but it was silent, and
            // the creator walked away believing their image was set. Say it,
            // without retracting the success above it.
            const { ok: pictureOk, error: pictureError } = await sendEditMetadata(relayUrl, groupId, { picture: result.url });
            if (!pictureOk) {
              toast({
                title: "Room created, but the picture didn't stick",
                description: pictureError ?? "The relay didn't accept the image.",
                variant: "destructive",
              });
            }
          }
        } catch {}
      }

      // Deliberately unreported. The creator did not ask to "join" — this is
      // bookkeeping after a creation that already succeeded, and the roster
      // fetch corrects it either way. Interrupting a success with a complaint
      // about a step nobody requested is worse than the silence.
      await sendJoinRequest(relayUrl, groupId).catch(() => {});
      setJoinedGroupIds((prev) => new Set([...prev, groupId]));
      // Skip the list update rather than rebuild it from a base we never loaded
      // — that publishes a 1-entry kind-10009 over every room they had joined.
      const base = await loadSimpleGroupsBase(pubkey);
      if (!base.blocked) {
        const normalizedRelay = relayUrl.replace(/\/+$/, "");
        const alreadyHas = base.entries.some((e) => e.groupId === groupId && e.relayUrl.replace(/\/+$/, "") === normalizedRelay);
        if (!alreadyHas) {
          await publishSimpleGroupsList([...base.entries, { groupId, relayUrl, name }]);
        }
      }

      const refreshed = await fetchGroupMetadata(relayUrl);
      setGroups(refreshed);

      const newGroup = refreshed.find((g) => g.id === groupId) || refreshed.find((g) => g.name === name);
      if (newGroup) {
        if (opts.autoOpenAddMember) {
          setAutoOpenAddMemberForGroup(newGroup.id);
        }
        setSelectedGroup(newGroup);
      }
      return true;
    } catch {
      toast({ title: "Error", description: "Something went wrong creating the room.", variant: "destructive" });
      return false;
    }
  }, [relayUrl, pubkey, toast, hasNip29]);

  const handleCreateChannel = useCallback(async () => {
    if (!newChannelName.trim() || !pubkey) return;
    setCreatingChannel(true);
    try {
      const ok = await createGroupFlow({
        name: newChannelName,
        about: newChannelAbout,
        isClosed: newChannelClosed,
        picture: newChannelPicture,
      });
      if (ok) resetCreateForm();
    } finally {
      setCreatingChannel(false);
    }
  }, [newChannelName, newChannelAbout, newChannelClosed, newChannelPicture, pubkey, createGroupFlow, resetCreateForm]);

  const handleCreateQuietRoom = useCallback(async () => {
    if (!pubkey) return;
    setCreatingQuietRoom(true);
    try {
      const stamp = Date.now().toString(36).slice(-4);
      const ok = await createGroupFlow({
        name: `Quiet room ${stamp}`,
        about: "Private friends-only room",
        isPrivate: true,
        isClosed: true,
        autoOpenAddMember: true,
        successTitle: "Quiet room created",
        successDescription: "Hidden from public discovery. Add a friend to invite them.",
      });
      if (ok) resetCreateForm();
    } finally {
      setCreatingQuietRoom(false);
    }
  }, [pubkey, createGroupFlow, resetCreateForm]);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<RoomFilter>("all");
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => getPinnedRooms(relayUrl));
  const [activityMap, setActivityMap] = useState<Record<string, number>>({});
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const activityFetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setPinnedIds(getPinnedRooms(relayUrl));
    setSearchQuery("");
    setActiveFilter("all");
    setVisibleCount(PAGE_SIZE);
    activityFetchedRef.current = new Set();
  }, [relayUrl]);

  useEffect(() => {
    if (!pubkey) return;
    const normalizedRelay = relayUrl.replace(/\/+$/, "");
    fetchSimpleGroupsList(pubkey)
      .then((entries) => {
        const joined = new Set(
          entries
            .filter((e) => e.relayUrl.replace(/\/+$/, "") === normalizedRelay)
            .map((e) => e.groupId),
        );
        setJoinedGroupIds(joined);
      })
      .catch(() => {});
  }, [pubkey, relayUrl]);

  useEffect(() => {
    if (!pubkey || groups.length === 0) return;
    // `!g.isOpen` — a room we hold no metadata for may still have an
    // outstanding 9021 from us. Gating on `isClosed` dropped it, so the row
    // offered "Join" again while the original request sat on the relay.
    const closedNotJoined = groups.filter((g) => !g.isOpen && !joinedGroupIds.has(g.id));
    if (closedNotJoined.length === 0) {
      setPendingGroupIds(new Set());
      return;
    }
    let done = false;
    const pendingIds = new Set<string>();
    const sub = subscribeToRoomRelay(
      relayUrl,
      { kinds: [KIND_GROUP_JOIN_REQUEST], authors: [pubkey], limit: 200 },
      {
        onevent(e: NostrEvent) {
          if (done) return;
          const gid = e.tags.find((t: string[]) => t[0] === "h")?.[1];
          if (gid) pendingIds.add(gid);
        },
        oneose() {
          if (done) return;
          done = true;
          sub.close();
          clearTimeout(timer);
          const filtered = new Set([...pendingIds].filter((gid) => {
            const g = groups.find((gr) => gr.id === gid);
            // `!g?.isOpen` also covers g === undefined: we sent the request, so
            // it is pending whatever the list does or does not know about it.
            return !g?.isOpen && !joinedGroupIds.has(gid);
          }));
          setPendingGroupIds(filtered);
        } },
    );
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        sub.close();
        const filtered = new Set([...pendingIds].filter((gid) => {
          const g = groups.find((gr) => gr.id === gid);
          return !g?.isOpen && !joinedGroupIds.has(gid);
        }));
        setPendingGroupIds(filtered);
      }
    }, 6000);
    return () => { done = true; sub.close(); clearTimeout(timer); };
  }, [pubkey, relayUrl, groups, joinedGroupIds]);

  useEffect(() => {
    // Guards the late-answer callback below: this effect re-runs on every
    // relayUrl change, so a slow relay's answer must not land on the community
    // the user has since navigated to.
    let stale = false;
    setLoading(true);
    setActivityMap({});
    activityFetchedRef.current = new Set();
    setRelayReached(null);
    setRelayRefused(null);
    // The result form, because the array form cannot express the difference
    // between "this relay has no rooms" and "this relay never replied" — and
    // the `.catch()` that used to be here was dead code: this fetch resolves
    // on timeout and has no reject path at all.
    fetchGroupMetadataResult(relayUrl, undefined, {
      // The relay may still be working after we stop waiting. We tell the
      // truth on time ("couldn't reach"), and if the rooms arrive late we fill
      // them in rather than making the user hit Try again. Guarded by the
      // effect's staleness flag so a late answer for a community the user has
      // navigated away from cannot overwrite the new one.
      onLate: (late) => {
        if (stale || late.length === 0) return;
        setGroups(late);
        setRelayReached(true);
        setRelayRefused(null);
        const meta: Record<string, number> = {};
        for (const g of late) if (g.metaUpdatedAt) meta[g.id] = g.metaUpdatedAt;
        setActivityMap(meta);
      },
    })
      .then(async ({ groups: fetched, reached, refusedReason }) => {
        if (stale) return;
        setGroups(fetched);
        setRelayReached(reached);
        setRelayRefused(refusedReason ?? null);
        setLoading(false);

        const metaActivity: Record<string, number> = {};
        for (const g of fetched) {
          if (g.metaUpdatedAt) metaActivity[g.id] = g.metaUpdatedAt;
        }
        setActivityMap(metaActivity);

      })
      .catch(() => {
        if (stale) return;
        setRelayReached(false);
        setLoading(false);
      });
    return () => { stale = true; };
  }, [relayUrl, refreshNonce]);

  const initialChannelHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialChannelId) return;
    const key = `${relayUrl}::${initialChannelId}`;
    if (initialChannelHandledRef.current === key) return;

    // Fast path: the invited channel showed up in the bulk discovery pass.
    const match = groups.find((g) => g.id === initialChannelId);
    if (match) {
      initialChannelHandledRef.current = key;
      setSelectedGroup(match);
      return;
    }

    // Don't declare the channel missing until the bulk fetch has finished —
    // otherwise we'd race discovery and fall back unnecessarily.
    if (loading) return;

    // Private/restricted/hidden channels — exactly the ones people share invite
    // links for — aren't returned to non-members in the kind 39000 limit:100
    // discovery. Resolve via a targeted single-group fetch, and if the relay
    // still serves nothing, synthesize a minimal entry so the room opens and the
    // invitee can Join using the `code` from the link.
    initialChannelHandledRef.current = key;
    let cancelled = false;
    setResolvingInviteChannel(true);
    fetchSingleGroupMetadata(relayUrl, initialChannelId)
      .then((meta) => {
        if (cancelled) return;
        if (meta) {
          setGroups((prev) => (prev.some((g) => g.id === meta.id) ? prev : [...prev, meta]));
          setSelectedGroup(meta);
        } else {
          setSelectedGroup({
            id: initialChannelId,
            isPrivate: true,
            isRestricted: true,
            isHidden: true,
            isClosed: true,
            // The relay served no metadata, so it never said "open" or
            // "public" — and this placeholder must not claim either on its
            // behalf. The `true`s above are the deliberately SAFE reading of
            // silence (assume locked); these two are the honest one (assume
            // nothing).
            isOpen: false,
            isPublic: false,
            // And this is what makes the honesty stick: `resolved:false` means
            // every door question answers "unknown" regardless of the guesses
            // above, so the defensive `true`s can drive behaviour without ever
            // being reported to anyone as fact. See lib/nip29-door.ts.
            resolved: false,
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSelectedGroup({
          id: initialChannelId,
          isPrivate: true,
          isRestricted: true,
          isHidden: true,
          isClosed: true,
          // As above: silence is not a claim in either direction.
          isOpen: false,
          isPublic: false,
          resolved: false,
        });
      })
      .finally(() => {
        if (!cancelled) setResolvingInviteChannel(false);
      });
    return () => { cancelled = true; };
  }, [initialChannelId, groups, relayUrl, loading]);

  useEffect(() => {
    if (groups.length === 0 || joinedGroupIds.size === 0) return;
    const joinedIds = [...joinedGroupIds].filter((id) => !activityFetchedRef.current.has(id));
    if (joinedIds.length === 0) return;
    joinedIds.forEach((id) => activityFetchedRef.current.add(id));
    fetchLastActivityBatch(relayUrl, joinedIds)
      .then((result) => {
        setActivityMap((prev) => ({ ...prev, ...result }));
      })
      .catch(() => {});
  }, [relayUrl, groups, joinedGroupIds]);

  const isGroupJoined = useCallback((gid: string) => {
    return joinedGroupIds.has(gid);
  }, [joinedGroupIds]);

  const isGroupPending = useCallback((gid: string) => {
    return pendingGroupIds.has(gid);
  }, [pendingGroupIds]);

  const handlePendingStateChange = useCallback((groupId: string, pending: boolean) => {
    setPendingGroupIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
    if (!pending) {
      setJoinedGroupIds((prev) => {
        const next = new Set(prev);
        next.add(groupId);
        return next;
      });
    }
  }, []);

  const filteredAndSorted = useMemo(() => {
    let filtered = groups;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((g) =>
        (g.name || g.id).toLowerCase().includes(q) ||
        (g.about || "").toLowerCase().includes(q)
      );
    }

    if (activeFilter === "joined") {
      filtered = filtered.filter((g) => isGroupJoined(g.id));
    } else if (activeFilter === "pinned") {
      filtered = filtered.filter((g) => pinnedIds.has(g.id));
    }

    return [...filtered].sort((a, b) => {
      const aPinned = pinnedIds.has(a.id) ? 1 : 0;
      const bPinned = pinnedIds.has(b.id) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;

      const aJoined = isGroupJoined(a.id) ? 1 : 0;
      const bJoined = isGroupJoined(b.id) ? 1 : 0;
      if (aJoined !== bJoined) return bJoined - aJoined;

      const aTs = activityMap[a.id] || 0;
      const bTs = activityMap[b.id] || 0;
      return bTs - aTs;
    });
  }, [groups, searchQuery, activeFilter, pinnedIds, activityMap, isGroupJoined]);

  const visibleRooms = useMemo(() => filteredAndSorted.slice(0, visibleCount), [filteredAndSorted, visibleCount]);
  const hasMore = visibleCount < filteredAndSorted.length;

  useEffect(() => {
    if (groups.length === 0 || visibleRooms.length === 0) return;
    const needFetch = visibleRooms
      .map((g) => g.id)
      .filter((id) => !activityFetchedRef.current.has(id));
    if (needFetch.length === 0) return;
    needFetch.forEach((id) => activityFetchedRef.current.add(id));
    fetchLastActivityBatch(relayUrl, needFetch)
      .then((result) => {
        setActivityMap((prev) => ({ ...prev, ...result }));
      })
      .catch(() => {});
  }, [relayUrl, groups, visibleRooms]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, activeFilter]);

  // Single "Pin" concept: pins the room to the TOP of the list (and the "Pinned"
  // filter) AND adds it to the sidebar Quick Access shortcuts — kept in sync, so
  // there's no separate star. Toggles off both together.
  const handleTogglePin = useCallback((groupId: string, groupName: string) => {
    const currentlyPinned = pinnedIds.has(groupId) || (quickAccessPinnedIds?.has(groupId) ?? false);
    const willPin = !currentlyPinned;
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (willPin) next.add(groupId); else next.delete(groupId);
      setPinnedRooms(relayUrl, next);
      return next;
    });
    // Sync the sidebar Quick Access shortcut to match (onQuickAccessPin is a toggle).
    const qaPinned = quickAccessPinnedIds?.has(groupId) ?? false;
    if (qaPinned !== willPin) onQuickAccessPin?.(groupId, groupName);
    toast({ title: willPin ? "Pinned — top of list + sidebar" : "Unpinned" });
  }, [relayUrl, toast, pinnedIds, quickAccessPinnedIds, onQuickAccessPin]);

  const handleGroupJoin = useCallback(async (groupId: string, groupName?: string) => {
    const groupMeta = groups.find((g) => g.id === groupId);
    // The room-LIST twin of handleJoin, and the second gate here that writes.
    // `groupMeta?.isClosed ?? false` was doubly wrong: it read "we never
    // learned" as open, AND defaulted a room missing from the list entirely to
    // open — so the least-known room got the most confident treatment.
    // `!groupMeta?.isOpen` is true for both of those, which is the safe side.
    const needsApproval = !groupMeta?.isOpen;
    setJoiningGroupId(groupId);
    try {
      const { ok: success, error } = await sendJoinRequest(relayUrl, groupId);
      if (success) {
        if (needsApproval) {
          setPendingGroupIds((prev) => new Set([...prev, groupId]));
          toast({ title: "Request sent", description: "A moderator will review your request." });
        } else {
          setJoinedGroupIds((prev) => new Set([...prev, groupId]));
          toast({ title: "Join request sent" });
          if (!pubkey) return;
          // See handleJoinGroup: never republish on an unloaded base.
          const base = await loadSimpleGroupsBase(pubkey);
          if (!base.blocked) {
            const alreadyHas = base.entries.some((e) => e.groupId === groupId && e.relayUrl.replace(/\/+$/, "") === relayUrl.replace(/\/+$/, ""));
            if (!alreadyHas) {
              await publishSimpleGroupsList([...base.entries, { groupId, relayUrl, name: groupName }]);
            }
          }
        }
      } else {
        toast({ title: "Couldn't send the request", description: error ?? "The relay didn't accept it.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    } finally {
      setJoiningGroupId(null);
    }
  }, [relayUrl, pubkey, toast, groups]);

  const handleGroupLeave = useCallback(async (groupId: string) => {
    try {
      const { ok: success, error } = await sendLeaveRequest(relayUrl, groupId);
      if (success) {
        setJoinedGroupIds((prev) => {
          const next = new Set(prev);
          next.delete(groupId);
          return next;
        });
        toast({ title: "Left group" });
        if (!pubkey) return;
        // A leave that can't load the base would publish every OTHER room away.
        const base = await loadSimpleGroupsBase(pubkey);
        if (!base.blocked) {
          await publishSimpleGroupsList(base.entries.filter((e) => !(e.groupId === groupId && e.relayUrl.replace(/\/+$/, "") === relayUrl.replace(/\/+$/, ""))));
        }
      } else {
        // Same silence as the in-room Leave, in the room LIST. Both had no
        // failure branch, so both looked like dead buttons on a refusal.
        toast({ title: "Couldn't leave", description: error ?? "The relay didn't accept it.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  }, [relayUrl, pubkey, toast]);


  // Wizard for creating a channel — handles relay capability + guidance itself.
  const handleWizardCreate = useCallback((opts: CreateChannelOpts) =>
    createGroupFlow({
      name: opts.name,
      about: opts.about,
      isPrivate: opts.isPrivate,
      isClosed: opts.isClosed,
      picture: opts.picture,
      autoOpenAddMember: opts.autoOpenAddMember,
    }),
  [createGroupFlow]);

  const createChannelWizard = (
    <CreateChannelWizard
      open={showCreateChannel}
      onOpenChange={(o) => { setShowCreateChannel(o); if (!o) onCreateChannelClose?.(); }}
      currentRelayUrl={relayUrl}
      currentRelayLabel={relayUrl.replace(/^wss?:\/\//, "").replace(/\/+$/, "")}
      onCreate={handleWizardCreate}
    />
  );

  if (!loading && groups.length === 0) {
    // Unreachable is checked FIRST, because every branch below makes a claim
    // about what this relay contains, and we have not heard from it. Saying
    // "no rooms yet — be the first!" to someone whose relay is simply down
    // invites them to create a duplicate of a channel that already exists.
    if (relayRefused) {
      return (
        <>
          <Card className="glass-card p-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Lock className="w-6 h-6 text-amber-500/60" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-brand tracking-wide text-foreground/70">This relay didn't accept your sign-in</h3>
                <p className="text-[10px] text-muted-foreground/50 leading-relaxed max-w-xs">
                  It's up, but it won't show us its rooms until it recognises your account. It said:
                  {" "}<span className="text-foreground/60">“{relayRefused}”</span>
                </p>
                <p className="text-[10px] text-muted-foreground/40 leading-relaxed max-w-xs pt-1">
                  Ask the relay's operator to add you, or sign in with an account it knows.
                </p>
              </div>
              <button
                onClick={() => setRefreshNonce((n) => n + 1)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border/40 text-xs font-medium hover:bg-muted/30 transition-colors"
                data-testid="button-retry-groups-auth"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Try again
              </button>
            </div>
          </Card>
          {createChannelWizard}
        </>
      );
    }

    if (relayReached === false) {
      return (
        <>
          <Card className="glass-card p-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <WifiOff className="w-6 h-6 text-amber-500/60" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-brand tracking-wide text-foreground/70">Couldn't reach this relay</h3>
                <p className="text-[10px] text-muted-foreground/50 leading-relaxed max-w-xs">
                  It didn't answer, so we don't know what rooms it has. Its chat may be fine — try again in a moment.
                </p>
              </div>
              <button
                onClick={() => setRefreshNonce((n) => n + 1)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border/40 text-xs font-medium hover:bg-muted/30 transition-colors"
                data-testid="button-retry-groups"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Try again
              </button>
            </div>
          </Card>
          {createChannelWizard}
        </>
      );
    }
    if (!hasNip29) {
      // Not a dead-end: this outpost can't host channels, but the wizard guides
      // the user to one that can (joined / curated / run-your-own).
      return (
        <>
          <Card className="glass-card p-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-amber-500/60" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-brand tracking-wide text-foreground/70">This community doesn't have chat yet</h3>
                <p className="text-[10px] text-muted-foreground/50 leading-relaxed max-w-xs">
                  Chat needs a relay running NIP-29. You can still start a channel — on a relay that supports it.
                </p>
              </div>
              {pubkey && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowCreateChannel(true)}
                  className="mt-1 text-[10px] text-brand gap-1"
                  data-testid="button-find-channel-relay"
                >
                  <Plus className="w-3 h-3" />
                  Find a channel relay
                </Button>
              )}
            </div>
          </Card>
          {createChannelWizard}
        </>
      );
    }

    return (
      <>
        <Card className="glass-card p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-muted-foreground/30" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-brand tracking-wide text-foreground/70">No rooms yet</h3>
              <p className="text-[10px] text-muted-foreground/50 leading-relaxed max-w-xs">
                This community doesn't have any group chat rooms yet.
                {pubkey ? " Be the first — create a room!" : " Rooms may be created by the community operator in the future."}
              </p>
            </div>
            {pubkey && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowCreateChannel(true)}
                className="mt-1 text-[10px] text-brand gap-1"
              >
                <Plus className="w-3 h-3" />
                Create Channel
              </Button>
            )}
          </div>
        </Card>
        {createChannelWizard}
      </>
    );
  }

  if (selectedGroup) {
    return (
      <>
        <ChannelRoomFrame>
            <ChatRoomView
              relayUrl={relayUrl}
              group={selectedGroup}
              isInitiallyJoined={joinedGroupIds.has(selectedGroup.id)}
              isInitiallyPending={pendingGroupIds.has(selectedGroup.id)}
              initialInviteCode={initialChannelId === selectedGroup.id ? initialInviteCode : undefined}
              isPinned={pinnedIds.has(selectedGroup.id)}
              isQuickAccessPinned={quickAccessPinnedIds?.has(selectedGroup.id)}
              autoOpenAddMember={autoOpenAddMemberForGroup === selectedGroup.id}
              onAutoOpenAddMemberConsumed={() => setAutoOpenAddMemberForGroup(null)}
              onBack={() => setSelectedGroup(null)}
              onTogglePin={() => handleTogglePin(selectedGroup.id, selectedGroup.name || selectedGroup.id)}
              onPendingStateChange={handlePendingStateChange}
              onGroupMetaChanged={(meta) => {
                setSelectedGroup(meta);
                setGroups((prev) => prev.map((g) => (g.id === meta.id ? meta : g)));
              }}
              trustFilterEnabled={trustFilterEnabled}
              isHiddenByTrust={isHiddenByTrust}
              onTrustHidden={onTrustHidden}
            />
        </ChannelRoomFrame>
        {createChannelWizard}
      </>
    );
  }

  if (resolvingInviteChannel && !selectedGroup) {
    return (
      <Card className="glass-card p-6">
        <div className="flex flex-col items-center justify-center min-h-[160px] gap-3 text-center">
          <RelayOutpostInlineLoader className="w-6 h-6" />
          <p className="text-sm text-muted-foreground/60">Opening room…</p>
          <p className="text-[10px] text-muted-foreground/40">
            Resolving access. You may need to tap Join once it opens.
          </p>
        </div>
      </Card>
    );
  }

  const joinedCount = groups.filter((g) => isGroupJoined(g.id)).length;
  const pinnedCount = groups.filter((g) => pinnedIds.has(g.id)).length;

  return (
    // No negative bottom margin here. It used to carry `-mb-16` to eat the
    // outpost page's bottom padding back when this WAS the whole tab — which
    // made the component report a height 64px shorter than its own content.
    // Embedded in a panel that clips (the Concord coexistence tab), that lie
    // cut the last row of room cards in half. A component owes its parent an
    // honest height; page-level spacing is the page's business.
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-brand tracking-wider uppercase text-brand">Rooms</h2>
          {loading && <RelayOutpostInlineLoader className="w-3.5 h-3.5" />}
        </div>
        {groups.length > 0 && (
          <span className="text-[10px] text-muted-foreground/40">
            {filteredAndSorted.length === groups.length
              ? `${groups.length} rooms`
              : `${filteredAndSorted.length} of ${groups.length} rooms`}
          </span>
        )}
      </div>

      {groups.length > 0 && (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search rooms…"
              className="h-8 text-base sm:text-xs pl-8 pr-11 sm:pr-8 bg-muted/20 border-border/30"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                // A 16px clear button living INSIDE the field's own tap box:
                // missing it drops the caret into the field and throws the
                // keyboard up over the room list. Gated at sm:, matching this
                // field's own `text-base sm:text-xs` no-zoom idiom, so there is
                // no band with a 44px control beside a 12px font.
                aria-label="Clear search"
                className="absolute right-1 sm:right-2.5 top-1/2 -translate-y-1/2 w-11 h-11 sm:w-auto sm:h-auto flex items-center justify-center sm:p-0.5 rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-muted-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Chips were 26px tall — under every thumb standard. They grow on a
              phone and keep the compact desktop size. */}
          <div className="flex items-center gap-1.5">
            {(["all", "joined", "pinned"] as RoomFilter[]).map((filter) => {
              const isActive = activeFilter === filter;
              const label = filter === "all" ? "All" : filter === "joined" ? `Joined${joinedCount > 0 ? ` (${joinedCount})` : ""}` : `Pinned${pinnedCount > 0 ? ` (${pinnedCount})` : ""}`;
              return (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(isActive ? "all" : filter)}
                  className={`px-3.5 min-h-11 md:min-h-0 md:px-2.5 md:py-1 rounded-full text-[11px] md:text-[10px] font-medium transition-colors border ${ isActive ? "bg-accent text-accent-foreground dark:text-brand border-brand/20" : "bg-muted/20 text-muted-foreground/70 border-border/30 hover:bg-muted/40" }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {loading && groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[120px] gap-3">
          <RelayOutpostInlineLoader className="w-6 h-6" />
          <p className="text-xs text-muted-foreground/50">Discovering chat rooms…</p>
        </div>
      ) : filteredAndSorted.length === 0 ? (
        <Card className="glass-card p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <Search className="w-8 h-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/50">No rooms match your search</p>
            <p className="text-[10px] text-muted-foreground/30">
              Try a different search term or filter
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setSearchQuery(""); setActiveFilter("all"); }}
              className="mt-1 text-[10px] text-brand"
            >
              Clear filters
            </Button>
          </div>
        </Card>
      ) : (
        <RoomList
          relayUrl={relayUrl}
          visibleRooms={visibleRooms}
          pinnedIds={pinnedIds}
          quickAccessPinnedIds={quickAccessPinnedIds}
          activeFilter={activeFilter}
          activityMap={activityMap}
          isGroupJoined={isGroupJoined}
          isGroupPending={isGroupPending}
          joiningGroupId={joiningGroupId}
          pubkey={pubkey}
          hasMore={hasMore}
          remainingCount={filteredAndSorted.length - visibleCount}
          onSelect={setSelectedGroup}
          onJoin={(gid, name) => handleGroupJoin(gid, name)}
          onLeave={handleGroupLeave}
          onTogglePin={handleTogglePin}
          onShowMore={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
        />
      )}

      {createChannelWizard}
    </div>
  );
}
