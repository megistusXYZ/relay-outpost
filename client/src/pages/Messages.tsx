import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { useLocation, useRoute } from "wouter";
import { useGoBack } from "@/hooks/use-go-back";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { PersonBadges } from "@/components/PersonBadges";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { eventStore, pool, DEFAULT_RELAYS, PROFILE_RELAYS, throttledPoolSubscribe, persistentPoolSubscribe, publishEvent, fetchProfilesCached, searchCachedProfiles, getCachedProfile, filterBlockedRelays, subscriptionAuthAcrossRelays } from "@/lib/nostr";
import { recordRecentDestination } from "@/lib/recent-destinations";
import { insertSorted } from "@/lib/message-list";
import { getProfileContent, KIND_METADATA } from "@/lib/nostr-helpers";
import { searchUsers } from "@/lib/primal-cache";
import { readDmLastRead, writeDmLastRead } from "@/lib/dm-read";
import { displayNameWith, usePetnamesVersion } from "@/lib/petnames";
import { fetchRelayLists, getWriteRelays, getReadRelays, getDMRelayListCached, fetchDMRelayList, getLocalDMRelays, hasDMRelayList, getDMRelaysForContact, getMyDMReceiveRelays, wasDMRelayListConfirmedEmpty, publishDMRelayList, DM_FALLBACK_RELAYS, ensureOwnDMRelayList, wasOwnDMInboxAutopublished } from "@/lib/outbox";
import { createGiftWrap, createGiftWrapForSelf } from "@/lib/dm";
import * as dmCache from "@/lib/dm-cache";
import { useToast } from "@/hooks/use-toast";
import { signWithTimeout, withSignerTimeout, SIGNER_CRYPTO_TIMEOUT } from "@/lib/signer-timeout";
import { RelayOutpostLoader, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { MessagesIcon } from "@/components/icons/MessagesIcon";
import {
  Send,
  ArrowLeft,
  ShieldCheck,
  Trash2,
  EyeOff,
  Undo2,
  Paperclip,
  Check,
  CalendarPlus,
  CalendarCheck,
  MapPin,
  Clock,
  AlertCircle,
  Lock,
  Loader2,
  ChevronDown, MessageCircle, X, MoreVertical, VolumeX, Flag } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ReportDialog } from "@/components/ReportDialog";
import { isMutedPubkey, mutePubkey, unmutePubkey } from "@/lib/spam-filter";
import { classifyUrl } from "@/lib/media-utils";
import { ImageLightbox, type LightboxImage } from "@/components/ImageLightbox";
import { ComposeEmojiPicker } from "@/components/ComposeEmojiPicker";
import { useCustomEmojis } from "@/hooks/use-custom-emojis";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardViewport } from "@/hooks/use-keyboard-viewport";
import {
  pinEvent,
  isEventPinned,
  savePrivateEvent,
  KIND_DATE_CALENDAR_EVENT,
  KIND_TIME_CALENDAR_EVENT,
  type CalendarEventData,
} from "@/lib/calendar-events";
import { encryptAndUploadDmFile, buildFileMessageTags, resolveDmFileUrl } from "@/lib/dm-file";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { Event } from "nostr-tools";
import { nip19, generateSecretKey, getPublicKey, finalizeEvent, getEventHash, verifyEvent } from "nostr-tools";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { unwrapGiftWrap, seedProcessedWraps, isWrapProcessed, KIND_DIRECT_INVITE_RUMOR } from "@/lib/gift-wrap";
import { stashDirectInviteRumor } from "@/lib/concord/concord-invites";
import { detectGroupInvite } from "@/lib/concord/invite-detect";
import { GroupInviteCard } from "@/components/GroupInviteCard";
import { EmbeddedNote } from "@/components/NostrPost";
import { getChannelWrapTimes, getConcordLastActivity, useConcordActivity, useConcordUnread } from "@/lib/concord/concord-unread";
import { computeUnreadChannels, readChannelLastRead } from "@/lib/concord/concord-channel-unread";
import { isCommunityMuted, isMuted } from "@/lib/concord/concord-mute";
import { mentionKey, pickFirstUnreadChannel, useConcordMentionCounts } from "@/lib/concord/concord-mentions";
import { CreateOutpostDialog } from "@/components/concord/CreateOutpostDialog";
import { DmDeliveryHealth } from "@/components/DmDeliveryHealth";
import { ChatList } from "./messages/ChatList";
import { buildCreateActions } from "./messages/create-actions";
import { useGroupChats, useGroupIdentities } from "./messages/useGroupChats";
import { useGroupTeasers } from "./messages/useGroupTeasers";
import { useHideMessagePreviews } from "@/lib/message-previews";
import { getDMDisplayName, mergeChatEntries, URL_REGEX, type ConversationPreview, type DmTab, type GroupPreview, type ProfileInfo } from "./messages/helpers";
import { lazyRetry } from "@/lib/lazy-retry";
import messagesEmptyBg from "../assets/images/messages-empty-bg.webp";

// Camera + QR decoder and the invite-link parser stay out of the main bundle
// until someone taps Scan / Join. Owned here (not in ChatList) so the empty-state
// actions and ChatList's "+" menu drive one shared render — no double-mount.
const QrScanSheet = lazy(() => lazyRetry(() => import("@/components/QrScanSheet")));
const JoinViaLinkDialog = lazy(() => lazyRetry(() => import("@/components/JoinViaLinkDialog")));

interface FileMetadata {
  url: string;
  mimeType?: string;
  size?: number;
  dim?: string;
  blurhash?: string;
  originalHash?: string;
  /** NIP-17 kind-15 encryption (hex) — present ⇒ the blob is AES-GCM ciphertext. */
  encAlgo?: string;
  encKey?: string;
  encNonce?: string;
}

interface DecodedMessage {
  id: string;
  content: string;
  from: string;
  timestamp: number;
  encryption: "nip04" | "nip44" | "nip17";
  fileMetadata?: FileMetadata;
  /** Private reply: the public note id this DM quotes (rumor `q` tag). When set,
   *  the bubble renders the quoted post + a "replied privately" label. */
  quotedNoteId?: string;
}

const NIP44_REQUIRED_MSG = "Your Nostr extension does not support NIP-44 encryption, which is required for private messages. Please use a compatible extension (Alby, nos2x, Nostore).";

const DM_PRIMARY_LS_KEY_PREFIX = "relay-outpost-dm-primary-";

function getPromotedPrimary(ownerPubkey: string): Set<string> {
  try {
    const raw = localStorage.getItem(DM_PRIMARY_LS_KEY_PREFIX + ownerPubkey);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function savePromotedPrimary(ownerPubkey: string, set: Set<string>) {
  try {
    localStorage.setItem(DM_PRIMARY_LS_KEY_PREFIX + ownerPubkey, JSON.stringify(Array.from(set)));
  } catch {}
}

const DM_DEMOTED_LS_KEY_PREFIX = "relay-outpost-dm-demoted-";

function getDemotedToRequests(ownerPubkey: string): Set<string> {
  try {
    const raw = localStorage.getItem(DM_DEMOTED_LS_KEY_PREFIX + ownerPubkey);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveDemotedToRequests(ownerPubkey: string, set: Set<string>) {
  try {
    localStorage.setItem(DM_DEMOTED_LS_KEY_PREFIX + ownerPubkey, JSON.stringify(Array.from(set)));
  } catch {}
}

const KIND_GIFT_WRAP = 1059;

function queryWithTimeout(relays: string[], filter: any, timeoutMs = 8000): Promise<Event[]> {
  return Promise.race([
    pool.querySync(relays, filter, {
      // Your own mailbox, on relays that require a sign-in to read it. Without
      // onauth, an auth-gated inbox relay CLOSEs the REQ and nostr-tools reports
      // it as an ordinary end-of-stream, so the thread renders as "no messages"
      // rather than "we were not allowed to look". Per-relay gated, so this
      // still never offers a pubkey to a relay the user hasn't opted into.
      onauth: subscriptionAuthAcrossRelays(),
      // And align nostr-tools' invented EOSE (baseEoseTimeout = 4400) with our
      // own patience, or a slow inbox relay gets cut off mid-answer and the
      // truncation is indistinguishable from having nothing to say. Same defect
      // as the one that emptied a four-channel community (#583).
      maxWait: timeoutMs,
      // `as any` because querySync's TYPE is narrower than its behaviour: it
      // declares Pick<…, "label" | "id" | "maxWait"> but spreads all params
      // straight into subscribeEose, which does honour onauth (verified in
      // nostr-tools 2.23.1, lib/esm/index.js:1282-1294).
    } as any),
    new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
  ]);
}

const conversationCache = new Map<string, DecodedMessage[]>();
const conversationCacheTimestamps = new Map<string, number>();
const CACHE_TTL = 30 * 60 * 1000;
const staleCacheKeys = new Set<string>();

function getCacheKey(myPubkey: string, contactPubkey: string): string {
  return `${myPubkey}:${contactPubkey}`;
}

function getCachedMessages(myPubkey: string, contactPubkey: string): DecodedMessage[] | null {
  const key = getCacheKey(myPubkey, contactPubkey);
  if (staleCacheKeys.has(key)) {
    staleCacheKeys.delete(key);
    conversationCache.delete(key);
    conversationCacheTimestamps.delete(key);
    return null;
  }
  const ts = conversationCacheTimestamps.get(key);
  if (!ts || Date.now() - ts > CACHE_TTL) {
    conversationCache.delete(key);
    conversationCacheTimestamps.delete(key);
    return null;
  }
  return conversationCache.get(key) || null;
}

function markCacheStale(myPubkey: string, contactPubkey: string) {
  staleCacheKeys.add(getCacheKey(myPubkey, contactPubkey));
}

function setCachedMessages(myPubkey: string, contactPubkey: string, messages: DecodedMessage[]) {
  const key = getCacheKey(myPubkey, contactPubkey);
  conversationCache.set(key, messages);
  conversationCacheTimestamps.set(key, Date.now());
}

function appendCachedMessage(myPubkey: string, contactPubkey: string, message: DecodedMessage) {
  const key = getCacheKey(myPubkey, contactPubkey);
  const existing = conversationCache.get(key);
  if (existing) {
    const ck = msgContentKey(message.from, message.timestamp, message.content);
    if (!existing.find(m => m.id === message.id) && !existing.find(m => msgContentKey(m.from, m.timestamp, m.content) === ck)) {
      existing.push(message);
      existing.sort((a, b) => a.timestamp - b.timestamp);
    }
  } else {
    conversationCache.set(key, [message]);
  }
  conversationCacheTimestamps.set(key, Date.now());
}

const HIDDEN_MESSAGES_KEY = "relay_outpost_hidden_dms";
const HIDDEN_CONVOS_KEY = "relay_outpost_hidden_convos";

function getHiddenMessageIds(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_MESSAGES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function addHiddenMessageId(id: string) {
  const set = getHiddenMessageIds();
  set.add(id);
  localStorage.setItem(HIDDEN_MESSAGES_KEY, JSON.stringify(Array.from(set)));
}

function getHiddenConvoPubkeys(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_CONVOS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function addHiddenConvoPubkey(pubkey: string) {
  const set = getHiddenConvoPubkeys();
  set.add(pubkey);
  localStorage.setItem(HIDDEN_CONVOS_KEY, JSON.stringify(Array.from(set)));
}

function removeHiddenConvoPubkey(pubkey: string) {
  const set = getHiddenConvoPubkeys();
  set.delete(pubkey);
  localStorage.setItem(HIDDEN_CONVOS_KEY, JSON.stringify(Array.from(set)));
}

function removeHiddenMessageId(id: string) {
  const set = getHiddenMessageIds();
  set.delete(id);
  localStorage.setItem(HIDDEN_MESSAGES_KEY, JSON.stringify(Array.from(set)));
}

function clearAllHiddenMessageIds() {
  localStorage.setItem(HIDDEN_MESSAGES_KEY, JSON.stringify([]));
}

function clearAllHiddenConvos() {
  localStorage.setItem(HIDDEN_CONVOS_KEY, JSON.stringify([]));
}

// getDMRelaysForContact + getMyDMReceiveRelays now live in @/lib/outbox (single
// source of truth, with NIP-65 write-relay fallback + health scoring).

// ensureOwnDMRelayList moved to @/lib/outbox so it can run at load (from
// NotificationContext), not only on first Chats open — a user who never opened
// Chats previously had no advertised kind-10050 inbox, dropping cross-client DMs.

// Catch-up queries fetch "since just-after the newest cached wrap". NIP-17
// randomizes a wrap's created_at up to 2 days in the PAST (dm.ts), so a wrap
// authored just before that cursor but back-dated earlier would be skipped —
// widen the lower bound by 2 days + slack. Replayed wraps are free (the
// decrypt-once ledger short-circuits already-processed ones), so the only cost
// is relay bandwidth on the query.
const DM_CATCHUP_BACKDATE_SLACK = 2 * 24 * 60 * 60 + 60;

/**
 * Read-only status probe for the DM delivery-health banner: true only when the
 * ensure-own-10050 routine above has conclusively left us WITHOUT a published
 * inbox — no cached list, a confirmed-empty query, and no success flag. A
 * transient fetch error (no confirmed-empty marker) stays false, so the rare
 * SELF banner never fires on a flaky network.
 */
function computeSelfAutopubFailed(pubkey: string): boolean {
  return !wasOwnDMInboxAutopublished(pubkey) && !hasDMRelayList(pubkey) && wasDMRelayListConfirmedEmpty(pubkey);
}

function toProfileInfo(data: any): ProfileInfo {
  return {
    name: data?.name,
    display_name: data?.display_name,
    picture: data?.picture,
    nip05: data?.nip05 };
}

interface CalendarInvitePayload {
  type: "calendar-invite";
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  startUnix?: number;
  endUnix?: number;
  location?: string;
  description?: string;
  kind: number;
  dTag: string;
  creatorPubkey: string;
  private?: boolean;
}

function parseCalendarInvite(content: string): { displayText: string; invite: CalendarInvitePayload | null } {
  const delimiter = "---OUTPOST_EVENT---";
  const idx = content.indexOf(delimiter);
  if (idx === -1) return { displayText: content, invite: null };

  const displayText = content.slice(0, idx).trimEnd();
  const jsonStr = content.slice(idx + delimiter.length).trim();
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed?.type === "calendar-invite" && parsed.title && parsed.date && parsed.dTag && parsed.creatorPubkey) {
      return { displayText, invite: parsed as CalendarInvitePayload };
    }
  } catch {}
  return { displayText: content, invite: null };
}

function CalendarInviteCard({ invite, userPubkey }: { invite: CalendarInvitePayload; userPubkey: string }) {
  const [pinned, setPinned] = useState(() => {
    const syntheticId = `invite-${invite.creatorPubkey}-${invite.dTag}`;
    return isEventPinned(userPubkey, syntheticId);
  });
  const { toast } = useToast();

  const handleAddToCalendar = () => {
    const syntheticId = `invite-${invite.creatorPubkey}-${invite.dTag}`;

    const startTime = invite.startUnix ?? (invite.startTime
      ? Math.floor(new Date(`${invite.date}T${invite.startTime}`).getTime() / 1000)
      : undefined);
    const endTime = invite.endUnix ?? (invite.endTime
      ? Math.floor(new Date(`${invite.date}T${invite.endTime}`).getTime() / 1000)
      : undefined);

    const isTimeBased = !!(startTime || invite.startTime);

    const calendarEvent: CalendarEventData = {
      id: syntheticId,
      pubkey: invite.creatorPubkey,
      dTag: invite.dTag,
      title: invite.title,
      description: invite.description || "",
      location: invite.location,
      startDate: !isTimeBased ? invite.date : undefined,
      startTime: isTimeBased ? startTime : undefined,
      endDate: !isTimeBased ? invite.date : undefined,
      endTime: isTimeBased ? endTime : undefined,
      hashtags: [],
      participants: [],
      references: [],
      kind: invite.kind || KIND_TIME_CALENDAR_EVENT,
      event: {
        id: syntheticId,
        pubkey: invite.creatorPubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: invite.kind || KIND_TIME_CALENDAR_EVENT,
        tags: [
          ["d", invite.dTag],
          ["title", invite.title],
          ...(startTime ? [["start", String(startTime)]] : [["start", invite.date]]),
          ...(endTime ? [["end", String(endTime)]] : !isTimeBased ? [["end", invite.date]] : []),
          ...(invite.location ? [["location", invite.location]] : []),
        ],
        content: invite.description || "",
        sig: "",
      },
    };

    savePrivateEvent(calendarEvent);
    pinEvent(userPubkey, syntheticId, calendarEvent);
    setPinned(true);
    toast({ title: "Added to Calendar", description: `"${invite.title}" pinned to your calendar.` });
  };

  const dateDisplay = new Date(invite.date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });

  return (
    <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <CalendarPlus className="w-3.5 h-3.5 text-amber-800/80 dark:text-amber-400/80" />
        <span className="text-[11px] font-medium text-amber-800/90 dark:text-amber-300/90">Event Invitation</span>
        {invite.private && <Lock className="w-3 h-3 text-amber-800/50 dark:text-amber-400/50" />}
      </div>
      <p className="text-xs font-medium text-foreground/90">{invite.title}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground/70">
        <span className="flex items-center gap-1">
          📅 {dateDisplay}
        </span>
        {invite.startTime && (
          <span className="flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {invite.startTime}{invite.endTime ? ` - ${invite.endTime}` : ""}
          </span>
        )}
        {invite.location && (
          <span className="flex items-center gap-1">
            <MapPin className="w-2.5 h-2.5" />
            {invite.location}
          </span>
        )}
      </div>
      {pinned ? (
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-800/80 dark:text-emerald-400/80 pt-0.5">
          <CalendarCheck className="w-3 h-3" />
          Added to your calendar
        </div>
      ) : (
        <button
          onClick={handleAddToCalendar}
          className="flex items-center gap-1.5 px-2.5 py-1 mt-0.5 text-[10px] rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
        >
          <CalendarPlus className="w-3 h-3" />
          Add to Calendar
        </button>
      )}
    </div>
  );
}

const EMOJI_SHORTCODE_RE = /:([a-zA-Z0-9_+-]+):/g;
// Built via RegExp() (not literals) so the Unicode-property /u flag isn't checked against
// the <ES6 tsc target; all target browsers support \p{...} at runtime.
const UNICODE_EMOJI_ONLY_RE = new RegExp("^(?:\\p{Extended_Pictographic}|\\uFE0F|\\u200D|\\s)+$", "u");
const HAS_PICTOGRAPH_RE = new RegExp("\\p{Extended_Pictographic}", "u");

/** NIP-30 emoji tags for the custom-emoji shortcodes used in a message, so other
 *  Nostr clients (and packs the recipient doesn't have locally) can render them. */
function buildEmojiTags(text: string, emojiMap: Map<string, string>): string[][] {
  const tags: string[][] = [];
  const seen = new Set<string>();
  const re = new RegExp(EMOJI_SHORTCODE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const sc = m[1];
    if (seen.has(sc)) continue;
    const url = emojiMap.get(sc);
    if (url) { tags.push(["emoji", sc, url]); seen.add(sc); }
  }
  return tags;
}

/** Render a text run with NIP-30 custom-emoji shortcodes (:name:) turned into images.
 *  Unknown shortcodes are left as literal text. `jumbo` sizes emoji-only messages up. */
function renderWithCustomEmoji(text: string, emojiMap: Map<string, string>, jumbo: boolean, keyBase: number) {
  if (!text) return null;
  const out: JSX.Element[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(EMOJI_SHORTCODE_RE.source, "g");
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    const url = emojiMap.get(m[1]);
    if (!url) continue; // leave unknown shortcode as literal text
    if (m.index > last) out.push(<span key={`${keyBase}-t${k++}`}>{text.slice(last, m.index)}</span>);
    out.push(
      <img
        key={`${keyBase}-e${k++}`}
        src={url}
        alt={`:${m[1]}:`}
        loading="lazy"
        className={`inline-block object-contain ${jumbo ? "h-12 w-12 align-middle" : "h-5 w-5 align-[-0.25em]"}`}
      />,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<span key={`${keyBase}-t${k++}`}>{text.slice(last)}</span>);
  return out.length ? out : <span key={`${keyBase}-t0`}>{text}</span>;
}

function DMMessageContent({ content, userPubkey, fileMetadata, isMine }: { content: string; userPubkey?: string; fileMetadata?: FileMetadata; isMine?: boolean }) {
  const { emojis } = useCustomEmojis();
  const emojiMap = useMemo(() => new Map(emojis.map((e) => [e.shortcode, e.url])), [emojis]);
  const [lightboxOpen, setLightboxOpen] = useState<{ images: LightboxImage[]; index: number } | null>(null);
  const { displayText, invite } = useMemo(() => parseCalendarInvite(content), [content]);

  // NIP-17 encrypted attachments (kind-15 with a decryption-key) can't be shown
  // by their ciphertext URL — fetch + AES-GCM decrypt to a blob URL first.
  const fileIsEncrypted = !!(fileMetadata?.encKey && fileMetadata?.encNonce);
  const [resolvedFileUrl, setResolvedFileUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState(false);
  useEffect(() => {
    if (!fileMetadata) { setResolvedFileUrl(null); setFileError(false); return; }
    if (!fileIsEncrypted) { setResolvedFileUrl(fileMetadata.url); setFileError(false); return; }
    let cancelled = false;
    setResolvedFileUrl(null); setFileError(false);
    resolveDmFileUrl({
      url: fileMetadata.url, mime: fileMetadata.mimeType,
      key: fileMetadata.encKey, nonce: fileMetadata.encNonce, algo: fileMetadata.encAlgo,
    })
      .then((u) => { if (!cancelled) setResolvedFileUrl(u); })
      .catch(() => { if (!cancelled) setFileError(true); });
    return () => { cancelled = true; };
  }, [fileMetadata?.url, fileMetadata?.encKey, fileMetadata?.encNonce, fileIsEncrypted]);

  const parts = useMemo(() => {
    if (fileMetadata) {
      const url = fileIsEncrypted ? resolvedFileUrl : fileMetadata.url;
      if (!url) return []; // encrypted + still decrypting (or failed) → handled below
      const mimeType = fileMetadata.mimeType || "";
      let mediaType: string | undefined;
      if (mimeType.startsWith("image/")) mediaType = "image";
      else if (mimeType.startsWith("video/")) mediaType = "video";
      else if (mimeType.startsWith("audio/")) mediaType = "audio";
      else mediaType = classifyUrl(url);
      return [{ type: "url" as const, value: url, mediaType }];
    }

    const segments: { type: "text" | "url"; value: string; mediaType?: string }[] = [];
    let lastIndex = 0;
    let match;
    const regex = new RegExp(URL_REGEX.source, "g");
    while ((match = regex.exec(displayText)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: "text", value: displayText.slice(lastIndex, match.index) });
      }
      const url = match[1];
      const mt = classifyUrl(url);
      segments.push({ type: "url", value: url, mediaType: mt });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < displayText.length) {
      segments.push({ type: "text", value: displayText.slice(lastIndex) });
    }
    return segments;
  }, [displayText, fileMetadata, fileIsEncrypted, resolvedFileUrl]);

  const mediaUrls = useMemo(() => parts.filter(p => p.type === "url" && (p.mediaType === "image" || p.mediaType === "video" || p.mediaType === "audio")), [parts]);
  const mediaUrlSet = useMemo(() => new Set(mediaUrls.map(p => p.value)), [mediaUrls]);
  const hasInlineMedia = mediaUrls.length > 0;

  // Group-chat invite links (from ANY Concord client's host) render as a Join
  // card instead of a plain link — pure URL-shape detection, and the card goes
  // to OUR internal /invite accept flow, never the foreign origin.
  const invites = useMemo(
    () => parts.flatMap(p => (p.type === "url" && !mediaUrlSet.has(p.value) ? (detectGroupInvite(p.value) ?? []) : [])),
    [parts, mediaUrlSet],
  );
  const inviteUrlSet = useMemo(
    () => new Set(parts.filter(p => p.type === "url" && detectGroupInvite(p.value)).map(p => p.value)),
    [parts],
  );

  const textParts = useMemo(() => parts.filter(seg => {
    if (seg.type === "url" && (mediaUrlSet.has(seg.value) || inviteUrlSet.has(seg.value))) return false;
    return true;
  }), [parts, mediaUrlSet, inviteUrlSet]);

  const hasTextContent = textParts.some(p =>
    (p.type === "text" && p.value.trim()) || (p.type === "url")
  );

  // "Jumbo" emoji like iMessage: when a message is ONLY emoji (custom shortcodes and/or
  // unicode pictographs, no media), render them large.
  const isEmojiOnly = useMemo(() => {
    if (hasInlineMedia) return false;
    const strippedCustom = displayText.replace(new RegExp(EMOJI_SHORTCODE_RE.source, "g"), (full, sc) => (emojiMap.has(sc) ? "" : full));
    if (strippedCustom.trim() === "") return strippedCustom !== displayText; // only custom emoji
    return UNICODE_EMOJI_ONLY_RE.test(strippedCustom) && HAS_PICTOGRAPH_RE.test(strippedCustom);
  }, [displayText, emojiMap, hasInlineMedia]);

  return (
    <div className="space-y-2">
      {fileMetadata && fileIsEncrypted && !resolvedFileUrl && (
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-6 text-xs ${isMine ? "text-[#f0eef8]/80" : "text-muted-foreground"} ${fileError ? "" : "animate-pulse"} bg-black/10 dark:bg-white/5 max-w-[15rem] sm:max-w-[20rem]`}
          data-testid="dm-media-encrypted-status"
        >
          {fileError ? (
            <span>Couldn't load this attachment.</span>
          ) : (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>Decrypting attachment…</span>
            </>
          )}
        </div>
      )}
      {hasInlineMedia && (
        <div className="space-y-2">
          {mediaUrls.map((seg, i) => {
            if (seg.mediaType === "image") {
              const allImages = mediaUrls.filter(s => s.mediaType === "image").map(s => ({ src: s.value, alt: "Shared image" }));
              const imgIndex = allImages.findIndex(img => img.src === seg.value);
              return (
                <img
                  key={i}
                  src={seg.value}
                  alt="Shared image"
                  decoding="async"
                  className="rounded-lg w-auto h-auto max-w-[15rem] sm:max-w-[20rem] max-h-[22rem] object-contain cursor-pointer"
                  loading="lazy"
                  onClick={() => setLightboxOpen({ images: allImages, index: Math.max(0, imgIndex) })}
                  data-testid={`dm-media-image-${i}`}
                />
              );
            }
            if (seg.mediaType === "video") {
              return (
                <video
                  key={i}
                  src={seg.value}
                  controls
                  preload="metadata"
                  className="rounded-lg w-auto h-auto max-w-[15rem] sm:max-w-[20rem] max-h-[22rem] object-contain"
                  data-testid={`dm-media-video-${i}`}
                />
              );
            }
            if (seg.mediaType === "audio") {
              return (
                <audio
                  key={i}
                  src={seg.value}
                  controls
                  preload="metadata"
                  className="w-full max-w-[280px]"
                  data-testid={`dm-media-audio-${i}`}
                />
              );
            }
            return null;
          })}
        </div>
      )}
      {hasTextContent ? (
        <p className={`${isMine ? "text-[#f0eef8]" : ""} ${isEmojiOnly ? "whitespace-pre-wrap break-words text-4xl leading-tight" : "reply-content-text whitespace-pre-wrap break-words"}`}>
          {textParts.map((seg, i) => {
            if (seg.type === "url") {
              return (
                <a
                  key={i}
                  href={seg.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`underline underline-offset-2 break-all ${
                    isMine
                      ? "text-[#c9b8ff] hover:text-[#ddd0ff]"
                      : "text-brand hover:text-brand/80"
                  }`}
                  data-testid={`dm-link-${i}`}
                >
                  {seg.value}
                </a>
              );
            }
            return <span key={i}>{renderWithCustomEmoji(seg.value, emojiMap, isEmojiOnly, i)}</span>;
          })}
        </p>
      ) : null}
      {invites.map((inv) => (
        // Definite width (like chat media above) so the fixed-height card
        // doesn't collapse to the bubble's text width.
        <div key={inv.path} className="w-[min(320px,70vw)] max-w-full">
          <GroupInviteCard invite={inv} compact />
        </div>
      ))}
      {invite && userPubkey && (
        <CalendarInviteCard invite={invite} userPubkey={userPubkey} />
      )}
      {lightboxOpen && (
        <ImageLightbox
          images={lightboxOpen.images}
          startIndex={lightboxOpen.index}
          onClose={() => setLightboxOpen(null)}
          testIdPrefix="dm-lightbox"
        />
      )}
    </div>
  );
}

function formatFullTime(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDateSeparator(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}

// Per-conversation last-read markers live in @/lib/dm-read (shared with the unread-DM
// count behind the Messages nav badge). Re-exported names kept for local call sites.

type MessageRenderItem =
  | { type: "date-separator"; label: string; key: string }
  | { type: "unread"; key: string }
  | { type: "message"; msg: DecodedMessage; showTimestamp: boolean; isClusterStart: boolean; isMine: boolean };

const KIND_SEAL = 13;
const KIND_RUMOR = 14;
const KIND_FILE_MESSAGE = 15;


const SIGNER_TIMEOUT = SIGNER_CRYPTO_TIMEOUT;

const DM_DEBUG = import.meta.env.DEV || localStorage.getItem("dmDebug") === "1";

async function ensureRelayConnections(relays: string[], timeoutMs = 3000): Promise<void> {
  await Promise.allSettled(
    relays.map(url =>
      Promise.race([
        pool.ensureRelay(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
      ])
    )
  );
}

async function publishWithFallback(relays: string[], event: Event, label?: string, skipFallbacks?: boolean): Promise<void> {
  const tag = label || `kind:${event.kind}`;
  const allRelays = filterBlockedRelays(
    skipFallbacks ? relays : Array.from(new Set([...relays, ...DM_FALLBACK_RELAYS]))
  );

  if (DM_DEBUG) console.log(`[DM] Publishing ${tag} (id: ${event.id?.slice(0, 12)}…) to ${allRelays.length} relays:`, allRelays.join(", "));

  // Pre-warm sockets, then route through the AUTH-aware publish path so relays
  // requiring NIP-42 AUTH get wait-for-AUTH-then-retry instead of an 8s silent
  // timeout. userSelected=true preserves our chosen DM relay set (no pruning).
  await ensureRelayConnections(allRelays);
  const ok = await publishEvent(event, allRelays, undefined, true);

  if (!ok) {
    throw new Error(`Could not publish ${tag} to any relay. Check your connection and try again.`);
  }
}


function randomTimeOffset(): number {
  return -Math.floor(Math.random() * 172800);
}

// NIP-17 p-tags SHOULD carry a relay-url hint: ["p", pubkey, relayUrl].
function pTag(pubkey: string, relayHint?: string): string[] {
  return relayHint ? ["p", pubkey, relayHint] : ["p", pubkey];
}

function msgContentKey(from: string, timestamp: number, content: string): string {
  return `${from}:${timestamp}:${content}`;
}

// createGiftWrap / createGiftWrapForSelf now live in @/lib/dm (single source of truth —
// these had drifted from the dm.ts copies). Imported at the top of this file.

export default function Messages() {
  const { pubkey, signer, follows } = useNostrAuth();
  const { getAuthorTier, followedByPubkeys, requestScoresBulk } = useGrapeRankScores();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const goBack = useGoBack();
  const [, threadMatch] = useRoute("/messages/:id");
  const navigateToConversation = useCallback((pk: string) => {
    try { setLocation(`/messages/${nip19.npubEncode(pk)}`); } catch { setLocation(`/messages/${pk}`); }
  }, [setLocation]);
  useDocumentTitle("Chats");

  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null);
  // Snapshot of the peer's last-read timestamp, frozen when the thread opens, so the
  // "Unread" divider stays put while you read (writeDmLastRead advances underneath it).
  const [unreadAnchorTs, setUnreadAnchorTs] = useState(0);
  const [messages, setMessages] = useState<DecodedMessage[]>([]);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const seenContentKeysRef = useRef<Set<string>>(new Set());
  const [newMessage, setNewMessage] = useState("");
  // Bumped when the app returns to the foreground / regains network, so the
  // live DM subscriptions tear down and re-establish — otherwise new messages
  // silently stop arriving after the app has been backgrounded for a while.
  const [reconnectTick, setReconnectTick] = useState(0);
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  // DM delivery health (problem-only banner): did our own kind-10050
  // auto-publish conclusively fail? Seeded from the caches on account change
  // and refreshed after ensureOwnDMRelayList settles (loadConversations).
  const [selfAutopubFailed, setSelfAutopubFailed] = useState(false);
  useEffect(() => {
    setSelfAutopubFailed(pubkey ? computeSelfAutopubFailed(pubkey) : false);
  }, [pubkey]);
  // Per-message optimistic send state (keyed by message id). Absent + in
  // deliveredMsgIds = sent (green check); "sending" = clock; "failed" = retry.
  const [msgStatus, setMsgStatus] = useState<Record<string, "sending" | "failed">>({});
  // Batched-decryption mode (Settings → Signer Behavior): when on, history is
  // not auto-decrypted; the user taps a single control to drain pending wraps.
  const [pendingDecryptCount, setPendingDecryptCount] = useState(0);
  const [decrypting, setDecrypting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  // Lifted from ChatList so the empty-state action rows and the "+" menu share
  // one sheet render (see the lazy QrScanSheet / JoinViaLinkDialog above).
  const [showQrScan, setShowQrScan] = useState(false);
  const [showJoinLink, setShowJoinLink] = useState(false);
  const [newChatInput, setNewChatInput] = useState("");
  const [profiles, setProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const [searchFilter, setSearchFilter] = useState("");
  const [dmTab, setDmTabRaw] = useState<DmTab>(() => {
    try {
      const saved = sessionStorage.getItem("relay-outpost-dm-tab");
      if (saved === "primary" || saved === "requests") return saved;
    } catch {}
    return "primary";
  });
  const setDmTab = useCallback((tab: DmTab) => {
    setDmTabRaw(tab);
    try { sessionStorage.setItem("relay-outpost-dm-tab", tab); } catch {}
  }, []);
  const [promotedPrimary, setPromotedPrimary] = useState<Set<string>>(() => pubkey ? getPromotedPrimary(pubkey) : new Set());
  const [demotedToRequests, setDemotedToRequests] = useState<Set<string>>(() => pubkey ? getDemotedToRequests(pubkey) : new Set());
  const [initiatedByMe, setInitiatedByMe] = useState<Set<string>>(new Set());
  const [userSearchResults, setUserSearchResults] = useState<{ pubkey: string; name: string; displayName?: string; picture?: string; nip05?: string }[]>([]);
  const [userSearching, setUserSearching] = useState(false);
  const [hiddenMsgIds, setHiddenMsgIds] = useState<Set<string>>(() => getHiddenMessageIds());
  const [hiddenConvos, setHiddenConvos] = useState<Set<string>>(() => getHiddenConvoPubkeys());
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "message" | "conversation"; id: string; isMine?: boolean } | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [isDeletedPreview, setIsDeletedPreview] = useState(false);
  // Store QA 2.8 (Apple 4.7.1 / Play blocking mandate): Report and Mute must
  // be reachable from the 1:1 thread itself, not only from the profile.
  const [showThreadReport, setShowThreadReport] = useState(false);
  const [threadMuted, setThreadMuted] = useState(false);
  useEffect(() => {
    setThreadMuted(selectedPubkey ? isMutedPubkey(selectedPubkey) : false);
  }, [selectedPubkey]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const liveSubRef = useRef<{ close: () => void } | null>(null);
  const selectedPubkeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const openConvoTokenRef = useRef(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      liveSubRef.current?.close();
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, []);


  const initialScrollDone = useRef(false);

  // Concord-chat parity: track whether the reader is pinned to the newest
  // message (within 80px). EVERY auto-scroll below is gated on this — the old
  // unconditional scrolls (on each `messages` change + every keyboard viewport
  // tick) yanked the thread around while typing and fought the user's finger
  // when they scrolled up to read ("shows different parts of the convo").
  const dmAtBottomRef = useRef(true);
  const [dmAtBottom, setDmAtBottom] = useState(true);
  const onDmMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    dmAtBottomRef.current = bottom;
    setDmAtBottom(bottom);
  }, []);

  const scrollToBottom = useCallback((instant = false) => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (instant) {
      container.scrollTop = container.scrollHeight;
    } else {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, []);

  const initialScrollTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const scrollToUnreadOrBottom = useCallback((instant = false) => {
    const container = messagesContainerRef.current;
    const divider = container?.querySelector("[data-dm-unread-divider]") as HTMLElement | null;
    if (divider) divider.scrollIntoView({ block: "center", behavior: instant ? "auto" : "smooth" });
    else scrollToBottom(instant);
  }, [scrollToBottom]);

  useEffect(() => {
    if (messages.length === 0) return;
    if (!initialScrollDone.current) {
      initialScrollDone.current = true;
      initialScrollTimers.current.forEach(clearTimeout);
      initialScrollTimers.current = [];
      requestAnimationFrame(() => scrollToUnreadOrBottom(true));
      const t1 = setTimeout(() => scrollToUnreadOrBottom(true), 50);
      const t2 = setTimeout(() => scrollToUnreadOrBottom(true), 150);
      const t3 = setTimeout(() => scrollToUnreadOrBottom(true), 400);
      initialScrollTimers.current = [t1, t2, t3];
    } else if (dmAtBottomRef.current) {
      // Only pin down when the reader is already at the bottom — never yank
      // someone who scrolled up to read (Concord-chat behavior).
      scrollToBottom();
    }
    return () => {
      initialScrollTimers.current.forEach(clearTimeout);
      initialScrollTimers.current = [];
    };
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!selectedPubkey) return;
    // A fresh thread always opens pinned to the newest message.
    dmAtBottomRef.current = true;
    setDmAtBottom(true);
    if (messages.length === 0) return;
    const t = setTimeout(() => scrollToBottom(true), 200);
    return () => clearTimeout(t);
  }, [selectedPubkey]);

  // Ride the visual viewport so the composer sits just above the keyboard and
  // snaps back when it closes (native iMessage/Twitter feel). Anchors the fixed
  // overlay to vv.height AND vv.offsetTop; keeping the composer scrolled into
  // view is handled below. Mobile only; desktop (md+, two-pane) lets CSS handle it.
  const { height: threadHeight, offsetTop: kbOffsetTop } = useKeyboardViewport(!!selectedPubkey);
  useEffect(() => {
    // Keyboard open/close resized the pane — re-pin the latest message above
    // the composer, but ONLY when the reader was at the bottom. Re-pinning on
    // every viewport tick while someone read scrollback (typing keeps the
    // viewport jittering) was the main "glitches while typing" source.
    if (threadHeight != null && dmAtBottomRef.current) requestAnimationFrame(() => scrollToBottom(true));
  }, [threadHeight, scrollToBottom]);

  // Instantly populate names/avatars for any pubkeys whose profile is already in
  // the local event store (very common — you've usually seen these people in the
  // feed), so the conversation list never sits on npub…/initials placeholders
  // while a relay round-trips. Returns the pubkeys still missing a profile.
  const seedProfilesFromStore = useCallback((pks: string[]): string[] => {
    const missing: string[] = [];
    const found = new Map<string, ProfileInfo>();
    for (const pk of pks) {
      if (profilesRef.current.has(pk)) continue;
      const existing = eventStore.getReplaceable(KIND_METADATA, pk);
      if (existing) found.set(pk, toProfileInfo(getProfileContent(existing)));
      else missing.push(pk);
    }
    if (found.size > 0) {
      setProfiles(prev => {
        const merged = new Map(prev);
        for (const [pk, p] of found) merged.set(pk, p);
        return merged;
      });
    }
    return missing;
  }, []);

  const fetchProfile = useCallback(async (pk: string) => {
    if (profilesRef.current.has(pk)) return profilesRef.current.get(pk)!;
    const existing = eventStore.getReplaceable(KIND_METADATA, pk);
    if (existing) {
      const raw = getProfileContent(existing);
      const p = toProfileInfo(raw);
      setProfiles(prev => new Map(prev).set(pk, p));
      return p;
    }
    // Warm the app-wide profile cache (fast dedicated PROFILE_RELAYS + batching).
    fetchProfilesCached([pk]);
    try {
      const events = await queryWithTimeout(PROFILE_RELAYS, { kinds: [KIND_METADATA], authors: [pk], limit: 1 }, 5000);
      if (events.length > 0) {
        const raw = getProfileContent(events[0]);
        const p = toProfileInfo(raw);
        setProfiles(prev => new Map(prev).set(pk, p));
        return p;
      }
    } catch {}
    return null;
  }, []);

  const [loadingTooLong, setLoadingTooLong] = useState(false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const loadConversations = useCallback(async (forceDecrypt = false) => {
    if (!pubkey) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadingTooLong(false);
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = setTimeout(() => setLoadingTooLong(true), 10000);

    const hiddenConvoSet = getHiddenConvoPubkeys();

    // Read the cache BEFORE requiring a signer. These conversations were
    // decrypted on a previous visit and are sitting in IndexedDB in the clear —
    // showing them needs no key at all. Extension/bunker/QR sessions restore
    // `pubkey` synchronously but boot with `signer` null while the connection is
    // re-established, and that reconnect can fail outright. Returning early here
    // skipped this read entirely, so every existing conversation vanished behind
    // "No conversations yet" — no spinner, no error, and Refresh did nothing
    // because it hit the same early return.
    const cachedConvs = await dmCache.getConversationList(pubkey);
    if (cachedConvs.length > 0) {
      const cachedList: ConversationPreview[] = cachedConvs
        .filter(c => !hiddenConvoSet.has(c.peerPubkey))
        .map(c => ({
          pubkey: c.peerPubkey,
          lastMessage: c.lastMessage,
          lastTimestamp: c.lastTimestamp,
          // Derive unread from the shared read ledger instead of hardcoding
          // false: a message that arrived while the app was closed (e.g. a chat
          // sitting in Requests) must still light the unread badge on load.
          unread: c.lastTimestamp > readDmLastRead(c.peerPubkey) }));
      setConversations(cachedList);
      setLoading(false);

      // Show cached profiles instantly, then only relay-fetch the ones we don't
      // have yet — from the fast dedicated profile relays (purplepag.es), not the
      // general feed relays which are slow/spotty for kind-0 lookups.
      const cachedProfilePks = seedProfilesFromStore(cachedList.map(c => c.pubkey)).slice(0, 50);
      if (cachedProfilePks.length > 0) {
        fetchProfilesCached(cachedProfilePks);
        queryWithTimeout(PROFILE_RELAYS, { kinds: [KIND_METADATA], authors: cachedProfilePks }, 5000)
          .then(profileEvents => {
            if (profileEvents.length > 0) {
              setProfiles(prev => {
                const merged = new Map(prev);
                for (const ev of profileEvents) {
                  const raw = getProfileContent(ev);
                  merged.set(ev.pubkey, toProfileInfo(raw));
                }
                return merged;
              });
            }
          })
          .catch((e) => console.warn("[DM] Profile batch fetch failed:", e?.message));
      }
    }

    // Everything past here fetches and decrypts NEW mail, which genuinely needs
    // the key. Without it we stop — but the cached list above is already on
    // screen, so the user keeps their chats instead of being told they have none.
    if (!signer?.nip44) {
      setLoading(false);
      return;
    }
    // Ensure the decrypt-once ledger is hydrated before we decide what's pending.
    await seedProcessedWraps(pubkey);
    const batchedMode = (() => {
      try { return localStorage.getItem("relay-outpost-batch-decryption") === "true"; } catch { return false; }
    })();

    const deadline = Date.now() + 15000;
    const pastDeadline = () => Date.now() > deadline;

    // Ensure our own kind-10050 inbox is published so others can route to us.
    // Once it settles, refresh the delivery-health banner's read-only view of
    // our own inbox (the publish mechanics above are untouched).
    ensureOwnDMRelayList(pubkey, signer).finally(() => {
      if (mountedRef.current) setSelfAutopubFailed(computeSelfAutopubFailed(pubkey));
    });

    const latestCachedTs = await dmCache.getLatestConversationTimestamp(pubkey);
    const sinceTs = latestCachedTs > 0 ? latestCachedTs - DM_CATCHUP_BACKDATE_SLACK : undefined;

    try {
      // Broad receive set: own inbox (10050) + read + write + fallbacks, scored.
      const fetchRelays = getMyDMReceiveRelays(pubkey);

      const [giftWraps] = await Promise.all([
        queryWithTimeout(fetchRelays, {
          kinds: [KIND_GIFT_WRAP], "#p": [pubkey],
          limit: sinceTs ? 100 : 200,
          ...(sinceTs ? { since: sinceTs } : {}) }),
      ]);

      const seenIds = new Set<string>();

      const convMap = new Map<string, { lastEvent: Event; lastMessage: string; timestamp: number }>();

      for (const c of cachedConvs) {
        if (!hiddenConvoSet.has(c.peerPubkey)) {
          convMap.set(c.peerPubkey, {
            lastEvent: null as any,
            lastMessage: c.lastMessage,
            timestamp: c.lastTimestamp });
        }
      }

      const BATCH_SIZE = 5;
      // Accumulate decoded messages per peer so we can persist them to the
      // THREAD store (MESSAGES_STORE) after the loop — not just the preview.
      const decodedByPeer = new Map<string, dmCache.CachedMessage[]>();
      const uniqueWraps = giftWraps.filter((w) => {
        if (seenIds.has(w.id)) return false;
        seenIds.add(w.id);
        return true;
      });
      // In batched mode, hold off auto-decrypting fresh history: surface a count
      // and let the user trigger one deliberate decrypt pass (forceDecrypt).
      const newWraps = uniqueWraps.filter((w) => !isWrapProcessed(w.id));
      const shouldDecrypt = forceDecrypt || !batchedMode;
      setPendingDecryptCount(shouldDecrypt ? 0 : newWraps.length);
      const wrapsToDecrypt = shouldDecrypt ? uniqueWraps : [];
      for (let i = 0; i < wrapsToDecrypt.length; i += BATCH_SIZE) {
        if (!mountedRef.current || pastDeadline()) break;
        const batch = wrapsToDecrypt.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map((wrap) => unwrapGiftWrap(signer, pubkey, wrap))
        );
        for (let j = 0; j < results.length; j++) {
          const r = results[j];
          if (r.status !== "fulfilled" || !r.value) continue;
          const unwrapped = r.value;
          // Concord direct invite (3313) riding the DM pipe: pending-invite
          // store only — its payload is secret key material, never DM text.
          if (unwrapped.rumorKind === KIND_DIRECT_INVITE_RUMOR) {
            stashDirectInviteRumor(pubkey, unwrapped);
            continue;
          }
          const otherPubkey: string = unwrapped.senderPubkey === pubkey
            ? unwrapped.recipientPubkey
            : unwrapped.senderPubkey;
          if (!otherPubkey || otherPubkey === pubkey) continue;
          if (hiddenConvoSet.has(otherPubkey)) continue;
          const existing = convMap.get(otherPubkey);
          if (!existing || unwrapped.timestamp > existing.timestamp) {
            convMap.set(otherPubkey, {
              lastEvent: batch[j],
              lastMessage: unwrapped.content,
              timestamp: unwrapped.timestamp });
          }
          // Persist the decoded message to the THREAD store — not just the
          // preview. The old loop wrote putConversation (preview) only, while
          // unwrapGiftWrap retired the wrap in the decrypt-once ledger — so the
          // thread store stayed empty and the conversation opened "No messages
          // yet" despite showing a last-message preview. Bulk-written below.
          const peerMsgs = decodedByPeer.get(otherPubkey) ?? [];
          peerMsgs.push({
            id: unwrapped.rumorId, ownerPubkey: pubkey, peerPubkey: otherPubkey,
            content: unwrapped.content, from: unwrapped.senderPubkey,
            timestamp: unwrapped.timestamp, encryption: "nip17",
            fileMetadata: unwrapped.fileMetadata, quotedNoteId: unwrapped.quotedNoteId });
          decodedByPeer.set(otherPubkey, peerMsgs);
        }
      }

      // Bulk-persist decoded messages to the thread store (one IDB txn per peer)
      // so preview + thread stores populate together — no more previewed-but-
      // empty conversations.
      for (const [peer, msgs] of decodedByPeer) {
        dmCache.putMessages(pubkey, peer, msgs).catch((e) => console.warn("[DM] Cache putMessages failed:", e?.message));
      }

      if (convMap.size > 0 && cachedConvs.length === 0) {
        const earlyList: ConversationPreview[] = Array.from(convMap.entries()).map(([pk, data]) => ({
          pubkey: pk,
          lastMessage: data.lastMessage,
          lastTimestamp: data.timestamp,
          unread: data.timestamp > readDmLastRead(pk) }));
        earlyList.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
        setConversations(earlyList);
        setLoading(false);
      }

      const convList: ConversationPreview[] = [];
      const profileFetches: string[] = [];

      const entries = Array.from(convMap.entries());
      for (const [pk, data] of entries) {
        convList.push({
          pubkey: pk,
          lastMessage: data.lastMessage,
          lastTimestamp: data.timestamp,
          unread: data.timestamp > readDmLastRead(pk) });
        if (!profilesRef.current.has(pk)) profileFetches.push(pk);

        dmCache.putConversation(pubkey, {
          ownerPubkey: pubkey,
          peerPubkey: pk,
          lastMessage: data.lastMessage,
          lastTimestamp: data.timestamp }).catch((e) => console.warn("[DM] Cache putConversation failed:", e?.message));
      }

      convList.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
      setConversations(convList);

      Array.from(hiddenConvoSet).forEach(hpk => {
        if (!profilesRef.current.has(hpk)) profileFetches.push(hpk);
      });

      const missingProfilePks = seedProfilesFromStore(profileFetches);
      if (missingProfilePks.length > 0) {
        fetchRelayLists(missingProfilePks.slice(0, 30));
        fetchProfilesCached(missingProfilePks.slice(0, 50));

        const profileEvents = await queryWithTimeout(PROFILE_RELAYS, {
          kinds: [KIND_METADATA],
          authors: missingProfilePks.slice(0, 50) }, 5000);
        if (profileEvents.length > 0) {
          setProfiles(prev => {
            const merged = new Map(prev);
            for (const ev of profileEvents) {
              const raw = getProfileContent(ev);
              merged.set(ev.pubkey, toProfileInfo(raw));
            }
            return merged;
          });
        }
      }
    } catch (err) {
      console.error("Failed to load conversations:", err);
    } finally {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
      setLoading(false);
    }
  }, [pubkey, signer]);

  // Batched mode: run one deliberate decrypt pass over the pending history.
  const decryptPending = useCallback(async () => {
    setDecrypting(true);
    try {
      await loadConversations(true);
    } finally {
      setDecrypting(false);
    }
  }, [loadConversations]);

  const hasNip44 = !!signer?.nip44;

  // Hydrate the decrypt-once ledger before any decryption runs, so wraps seen
  // in a previous session are never sent to the signer again.
  useEffect(() => {
    if (pubkey) seedProcessedWraps(pubkey);
  }, [pubkey]);

  useEffect(() => {
    loadConversations();
  }, [pubkey, signer, hasNip44]);

  // Re-establish the live DM subscription when the app returns to the
  // foreground or regains network. Debounced so rapid visibility flips (and the
  // app's pull-to-refresh "nostr-soft-refresh") don't thrash the relays.
  useEffect(() => {
    let last = 0;
    const bump = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - last < 3000) return;
      last = now;
      setReconnectTick((t) => t + 1);
    };
    const onVis = () => { if (document.visibilityState === "visible") bump(); };
    window.addEventListener("online", bump);
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("nostr-soft-refresh", bump);
    return () => {
      window.removeEventListener("online", bump);
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("nostr-soft-refresh", bump);
    };
  }, []);

  useEffect(() => {
    if (!pubkey || !signer?.nip44) return;

    const filters: any[] = [
      { kinds: [KIND_GIFT_WRAP], "#p": [pubkey], since: Math.floor(Date.now() / 1000) - 172800 },
    ];

    // By design: decrypted DMs go to `dmCache` (not the applesauce `eventStore`).
    // Encrypted gift wraps have no reactive model; the decrypt-once ledger dedups.
    const handleGiftWrap = (ev: any) => {
      unwrapGiftWrap(signer, pubkey, ev).then(unwrapped => {
        if (!mountedRef.current || !unwrapped) return;

        // Concord direct invite (3313): stash as a pending invite, never a DM.
        if (unwrapped.rumorKind === KIND_DIRECT_INVITE_RUMOR) {
          stashDirectInviteRumor(pubkey, unwrapped);
          return;
        }

        const otherPubkey = unwrapped.senderPubkey === pubkey
          ? unwrapped.recipientPubkey
          : unwrapped.senderPubkey;
        if (!otherPubkey || otherPubkey === pubkey) return;

        markCacheStale(pubkey, otherPubkey);

        setConversations(prev => {
          const filtered = prev.filter(c => c.pubkey !== otherPubkey);
          filtered.unshift({
            pubkey: otherPubkey,
            lastMessage: unwrapped.content,
            lastTimestamp: unwrapped.timestamp,
            unread: true });
          return filtered;
        });

        const newMsg = {
          id: unwrapped.rumorId,
          content: unwrapped.content,
          from: unwrapped.senderPubkey,
          timestamp: unwrapped.timestamp,
          encryption: "nip17" as const,
          fileMetadata: unwrapped.fileMetadata,
          quotedNoteId: unwrapped.quotedNoteId };
        appendCachedMessage(pubkey, otherPubkey, newMsg);
        dmCache.putMessage(pubkey, otherPubkey, {
          id: newMsg.id, ownerPubkey: pubkey, peerPubkey: otherPubkey,
          content: newMsg.content, from: newMsg.from,
          timestamp: newMsg.timestamp, encryption: newMsg.encryption,
          fileMetadata: newMsg.fileMetadata, quotedNoteId: newMsg.quotedNoteId }).catch((e) => console.warn("[DM] Cache putMessage failed:", e?.message));
        dmCache.putConversation(pubkey, {
          ownerPubkey: pubkey, peerPubkey: otherPubkey,
          lastMessage: unwrapped.content, lastTimestamp: unwrapped.timestamp }).catch((e) => console.warn("[DM] Cache putConversation failed:", e?.message));

        if (selectedPubkeyRef.current === otherPubkey) {
          setMessages(prev => {
            if (seenMessageIdsRef.current.has(unwrapped.rumorId)) return prev;
            const ck = msgContentKey(newMsg.from, newMsg.timestamp, newMsg.content);
            if (seenContentKeysRef.current.has(ck)) return prev;
            seenMessageIdsRef.current.add(unwrapped.rumorId);
            seenContentKeysRef.current.add(ck);
            return insertSorted(prev, newMsg, (m) => m.timestamp);
          });
        }

        fetchProfile(otherPubkey);
      });
    };

    // Incoming gift wraps (#p = me) land on MY inbox relays — subscribe broadly
    // across own 10050 + read + write + fallbacks so nothing is missed.
    const liveRelays = getMyDMReceiveRelays(pubkey);

    const globalSub = persistentPoolSubscribe(liveRelays, filters, {
      onevent(ev) {
        if (!mountedRef.current) return;
        if (ev.kind === KIND_GIFT_WRAP) handleGiftWrap(ev);
      } });

    return () => globalSub.close();
  }, [pubkey, signer, reconnectTick]);

  const startLiveThread = useCallback((contactPubkey: string) => {
    if (!pubkey || !signer?.nip44) return;

    liveSubRef.current?.close();

    // Thread sub filters #p = me → incoming wraps live on MY inbox relays.
    const dmRelays = getMyDMReceiveRelays(pubkey);
    const since = Math.floor(Date.now() / 1000);

    const threadFilters: any[] = [
      { kinds: [KIND_GIFT_WRAP], "#p": [pubkey], since: since - 172800 },
    ];

    const threadSub = persistentPoolSubscribe(dmRelays, threadFilters, {
      onevent(ev) {
        if (!mountedRef.current) return;

        if (ev.kind === KIND_GIFT_WRAP) {
          unwrapGiftWrap(signer, pubkey, ev).then(unwrapped => {
            if (!mountedRef.current || !unwrapped) return;

            // Concord direct invite (3313): stash as a pending invite, never a DM.
            if (unwrapped.rumorKind === KIND_DIRECT_INVITE_RUMOR) {
              stashDirectInviteRumor(pubkey, unwrapped);
              return;
            }

            const isRelevant =
              (unwrapped.senderPubkey === contactPubkey && unwrapped.recipientPubkey === pubkey) ||
              (unwrapped.senderPubkey === pubkey && unwrapped.recipientPubkey === contactPubkey);
            if (!isRelevant) return;

            const newMsg: DecodedMessage = {
              id: unwrapped.rumorId,
              content: unwrapped.content,
              from: unwrapped.senderPubkey,
              timestamp: unwrapped.timestamp,
              encryption: "nip17",
              fileMetadata: unwrapped.fileMetadata,
              quotedNoteId: unwrapped.quotedNoteId };

            appendCachedMessage(pubkey, contactPubkey, newMsg);
            dmCache.putMessage(pubkey, contactPubkey, {
              id: newMsg.id, ownerPubkey: pubkey, peerPubkey: contactPubkey,
              content: newMsg.content, from: newMsg.from,
              timestamp: newMsg.timestamp, encryption: newMsg.encryption,
              fileMetadata: newMsg.fileMetadata, quotedNoteId: newMsg.quotedNoteId }).catch((e) => console.warn("[DM] Cache putMessage failed:", e?.message));

            setMessages(prev => {
              if (seenMessageIdsRef.current.has(unwrapped.rumorId)) return prev;
              const ck = msgContentKey(newMsg.from, newMsg.timestamp, newMsg.content);
              if (seenContentKeysRef.current.has(ck)) return prev;
              seenMessageIdsRef.current.add(unwrapped.rumorId);
              seenContentKeysRef.current.add(ck);
              return insertSorted(prev, newMsg, (m) => m.timestamp);
            });
          });
        }
      } });

    liveSubRef.current = threadSub;
  }, [pubkey, signer]);

  // "Publish inbox" (delivery-health banner) re-runs the EXISTING auto-publish
  // routine — no new publish path. ensureOwnDMRelayList clears its in-flight
  // guard on completion and only sets the success flag when the publish lands,
  // so a user-initiated re-run after a failure is safe and idempotent.
  const handlePublishOwnInbox = useCallback(async (): Promise<boolean> => {
    if (!pubkey || !signer) return false;
    await ensureOwnDMRelayList(pubkey, signer);
    const failed = computeSelfAutopubFailed(pubkey);
    setSelfAutopubFailed(failed);
    return !failed;
  }, [pubkey, signer]);

  const openConversation = useCallback(async (contactPubkey: string, previewOnly = false) => {
    if (!pubkey || !signer?.nip44) return;
    const requestToken = ++openConvoTokenRef.current;
    setSelectedPubkey(contactPubkey);
    selectedPubkeyRef.current = contactPubkey;
    // "Jump back in" MRU (Stories menu): label/avatar from the local profile
    // cache only — recording must never trigger a fetch. getCachedProfile
    // returns the kind-0 EVENT, so read fields through getProfileContent.
    try {
      const cachedEv = getCachedProfile(contactPubkey);
      const prof = cachedEv ? getProfileContent(cachedEv) : undefined;
      recordRecentDestination(pubkey, {
        type: "dm",
        id: contactPubkey,
        path: `/messages/${nip19.npubEncode(contactPubkey)}`,
        label: prof?.display_name || prof?.name || undefined,
        avatar: prof?.picture || undefined,
      });
    } catch {}
    setUnreadAnchorTs(readDmLastRead(contactPubkey));
    window.dispatchEvent(new Event("dm-thread-open"));
    initialScrollDone.current = false;

    // Backfill the MRU record once the profile actually loads: the record
    // above is cache-only, so opening a thread before the kind-0 arrived
    // stored label/avatar as undefined — and the launcher's "Jump back in"
    // then showed a raw npub + initials forever. Re-recording the ACTIVE
    // thread with real identity is idempotent (it is the most recent
    // destination by definition). One-shot, cancelled if the user switches.
    void (async () => {
      for (const delay of [800, 2000, 4000]) {
        await new Promise((r) => setTimeout(r, delay));
        if (openConvoTokenRef.current !== requestToken) return;
        const ev = getCachedProfile(contactPubkey);
        if (!ev) continue;
        try {
          const p = getProfileContent(ev);
          const label = p?.display_name || p?.name;
          if (label) {
            recordRecentDestination(pubkey, {
              type: "dm",
              id: contactPubkey,
              path: `/messages/${nip19.npubEncode(contactPubkey)}`,
              label,
              avatar: p?.picture || undefined,
            });
          }
        } catch {}
        return;
      }
    })();

    fetchRelayLists([contactPubkey]);

    const cached = getCachedMessages(pubkey, contactPubkey);
    if (cached && cached.length > 0) {
      seenMessageIdsRef.current = new Set(cached.map(m => m.id));
      seenContentKeysRef.current = new Set(cached.map(m => msgContentKey(m.from, m.timestamp, m.content)));
      cached.forEach(m => { if (m.from === pubkey) deliveredMsgIds.current.add(m.id); });
      setMessages(cached);
      setThreadLoading(false);
      if (!previewOnly) startLiveThread(contactPubkey);
      fetchProfile(contactPubkey);
      return;
    }

    let idbMessages: DecodedMessage[] = [];
    let idbLatestTs = 0;
    try {
      const idbCached = await dmCache.getMessages(pubkey, contactPubkey);
      if (openConvoTokenRef.current !== requestToken) return;
      if (idbCached.length > 0) {
        const hiddenSet = getHiddenMessageIds();
        idbMessages = idbCached
          .filter(m => !hiddenSet.has(m.id))
          .map(m => ({
            id: m.id,
            content: m.content,
            from: m.from,
            timestamp: m.timestamp,
            encryption: m.encryption,
            fileMetadata: m.fileMetadata ? {
              url: m.fileMetadata.url,
              mimeType: m.fileMetadata.mimeType,
              size: m.fileMetadata.size,
              dim: m.fileMetadata.dim,
              blurhash: m.fileMetadata.blurhash,
              originalHash: m.fileMetadata.originalHash,
              encAlgo: m.fileMetadata.encAlgo,
              encKey: m.fileMetadata.encKey,
              encNonce: m.fileMetadata.encNonce,
            } : undefined,
            quotedNoteId: m.quotedNoteId }));
        if (idbMessages.length > 0) {
          seenMessageIdsRef.current = new Set(idbMessages.map(m => m.id));
          seenContentKeysRef.current = new Set(idbMessages.map(m => msgContentKey(m.from, m.timestamp, m.content)));
          idbMessages.forEach(m => { if (m.from === pubkey) deliveredMsgIds.current.add(m.id); });
          setMessages(idbMessages);
          setCachedMessages(pubkey, contactPubkey, idbMessages);
          setThreadLoading(false);
          idbLatestTs = Math.max(...idbMessages.map(m => m.timestamp));
        }
      }
    } catch {}

    if (openConvoTokenRef.current !== requestToken) return;

    if (idbMessages.length === 0) {
      setThreadLoading(true);
    }

    try {
      fetchProfile(contactPubkey);
      // Warm the contact's relay cache for when we reply; history below queries
      // MY inbox relays since the filter is #p = me.
      fetchDMRelayList(contactPubkey).catch((e) => console.warn("[DM] fetchDMRelayList failed for contact:", e?.message));

      // For a single opened conversation, check broadly (Wisp-style): wraps are
      // #p = me, so they live on MY inbox relays — but a sender that mis-routes
      // may have left them on the contact's relays instead. Union both (bounded).
      const dmRelays = filterBlockedRelays(
        Array.from(new Set([
          ...getMyDMReceiveRelays(pubkey),
          ...getDMRelaysForContact(contactPubkey, pubkey),
        ]))
      ).slice(0, 16);

      const sinceTs = idbLatestTs > 0 ? idbLatestTs - DM_CATCHUP_BACKDATE_SLACK : undefined;

      const giftWraps = await queryWithTimeout(dmRelays, {
        kinds: [KIND_GIFT_WRAP], "#p": [pubkey],
        limit: sinceTs ? 50 : 100,
        ...(sinceTs ? { since: sinceTs } : {}) });

      if (openConvoTokenRef.current !== requestToken) return;

      const seen = new Set<string>();
      for (const id of seenMessageIdsRef.current) seen.add(id);

      const hiddenSet = getHiddenMessageIds();
      const decoded: DecodedMessage[] = [];

      // Self-heal: when a thread has NOTHING cached, its wraps may have been
      // decrypted in a past session (so they're marked "processed") but their
      // text was never stored — re-fetching then skips them and the thread shows
      // blank. Force re-decrypt in that case so old conversations re-populate.
      // (One-time per thread: results get cached below. Foreign wraps are
      // rejected before any signer call, so this won't spam a remote signer.)
      const forceDecrypt = idbMessages.length === 0;

      const seenRumorIds = new Set<string>(seenMessageIdsRef.current);
      const WRAP_BATCH = 5;
      const uniqueWraps = giftWraps.filter(w => {
        if (seen.has(w.id)) return false;
        seen.add(w.id);
        return true;
      });
      // Bound the self-heal cost, but cover the full fetched window (≤100) so an
      // OLDER conversation whose wraps aren't among the newest 40 actually heals
      // on open instead of staying blank (the reported "preview shows, thread
      // empty" bug). Newest-first + batched (yields every WRAP_BATCH) + aborts on
      // thread-switch keeps this mobile-safe; it runs at most once per thread
      // (results are cached below). Non-force opens keep the full set anyway.
      const FORCE_DECRYPT_CAP = 100;
      const wrapsToProcess = forceDecrypt
        ? [...uniqueWraps].sort((a, b) => b.created_at - a.created_at).slice(0, FORCE_DECRYPT_CAP)
        : uniqueWraps;
      for (let i = 0; i < wrapsToProcess.length; i += WRAP_BATCH) {
        // Abort if the user switched threads / navigated away mid-decrypt — else
        // we burn CPU and may overwrite the newly-opened thread with stale data.
        if (openConvoTokenRef.current !== requestToken) return;
        const batch = wrapsToProcess.slice(i, i + WRAP_BATCH);
        const results = await Promise.allSettled(
          batch.map(wrap => unwrapGiftWrap(signer, pubkey, wrap, { force: forceDecrypt }))
        );
        for (const r of results) {
          if (r.status !== "fulfilled" || !r.value) continue;
          const unwrapped = r.value;
          // Concord direct invite (3313): stash as a pending invite, never a DM.
          // (The self-heal force pass can re-decrypt an already-processed 3313
          // wrap — without this it would leak the bundle into the thread.)
          if (unwrapped.rumorKind === KIND_DIRECT_INVITE_RUMOR) {
            stashDirectInviteRumor(pubkey, unwrapped);
            continue;
          }
          const isRelevant =
            (unwrapped.senderPubkey === contactPubkey && unwrapped.recipientPubkey === pubkey) ||
            (unwrapped.senderPubkey === pubkey && unwrapped.recipientPubkey === contactPubkey);
          if (!isRelevant) continue;
          if (hiddenSet.has(unwrapped.rumorId)) continue;
          if (seenRumorIds.has(unwrapped.rumorId)) continue;
          seenRumorIds.add(unwrapped.rumorId);
          decoded.push({
            id: unwrapped.rumorId,
            content: unwrapped.content,
            from: unwrapped.senderPubkey,
            timestamp: unwrapped.timestamp,
            encryption: "nip17",
            fileMetadata: unwrapped.fileMetadata,
            quotedNoteId: unwrapped.quotedNoteId });
        }
      }

      // The (force-)decrypt loop can run a while; bail if it's now stale so we
      // never commit one thread's history into another the user just opened.
      if (openConvoTokenRef.current !== requestToken) return;

      if (decoded.length > 0) {
        // RACE FIX: previously we built `deduped` from `[...idbMessages,
        // ...decoded]` and called `setMessages(deduped)`, which OVERWROTE
        // any messages the global gift-wrap subscription pushed into state
        // via handleGiftWrap while we were fetching/decoding history. The
        // fix uses a functional updater so we merge with whatever React
        // currently holds — handleGiftWrap also uses a functional updater,
        // so React serializes the two and our merge sees its writes.
        //
        // Refs/in-memory cache are mirrors of the visible state and live
        // inside the updater so they're always consistent with what we
        // return; they're idempotent so StrictMode double-invocation is
        // harmless. (handleGiftWrap reads seenMessageIdsRef synchronously
        // for dedupe, so we can't push these to a post-commit effect
        // without opening a window where duplicates slip through.)
        setMessages(prev => {
          const merged: DecodedMessage[] = [];
          const idSet = new Set<string>();
          const contentKeySet = new Set<string>();
          const all = [...prev, ...idbMessages, ...decoded].sort((a, b) => a.timestamp - b.timestamp);
          for (const m of all) {
            if (idSet.has(m.id)) continue;
            const ck = msgContentKey(m.from, m.timestamp, m.content);
            if (contentKeySet.has(ck)) continue;
            idSet.add(m.id);
            contentKeySet.add(ck);
            merged.push(m);
          }
          seenMessageIdsRef.current = idSet;
          seenContentKeysRef.current = contentKeySet;
          for (const m of merged) {
            if (m.from === pubkey) deliveredMsgIds.current.add(m.id);
          }
          setCachedMessages(pubkey, contactPubkey, merged);
          return merged;
        });

        // Persist the decoded historical batch independent of the React
        // updater. We don't need to observe the merged result for IDB:
        // the global gift-wrap subscription persists its own arrivals
        // individually via dmCache.putMessage, so cache coverage is
        // (decoded historical batch) ∪ (per-arrival writes) = complete.
        // Decoupling the IDB write removes any dependency on React 18's
        // scheduler having run our updater before this line.
        const idbEntries: dmCache.CachedMessage[] = decoded.map(m => ({
          id: m.id,
          ownerPubkey: pubkey,
          peerPubkey: contactPubkey,
          content: m.content,
          from: m.from,
          timestamp: m.timestamp,
          encryption: m.encryption,
          fileMetadata: m.fileMetadata,
          quotedNoteId: m.quotedNoteId,
        }));
        dmCache.putMessages(pubkey, contactPubkey, idbEntries).catch((e) => console.warn("[DM] Cache putMessages failed:", e?.message));
      } else if (idbMessages.length === 0) {
        seenMessageIdsRef.current = new Set();
        seenContentKeysRef.current = new Set();
        setMessages([]);
      }

      if (!previewOnly) startLiveThread(contactPubkey);
    } catch (err) {
      console.error("Failed to load thread:", err);
      if (idbMessages.length === 0) {
        toast({ title: "Failed to load messages", variant: "destructive" });
      }
    } finally {
      setThreadLoading(false);
    }
  }, [pubkey, signer, fetchProfile, toast, startLiveThread]);

  // Encrypt + publish a DM in the background, reconciling the optimistic
  // message's status (sending → sent, or failed). Shared by send and retry.
  const { emojis: dmEmojiList } = useCustomEmojis();
  const dmEmojiMap = useMemo(() => new Map(dmEmojiList.map((e) => [e.shortcode, e.url])), [dmEmojiList]);
  const deliverMessage = useCallback(async (clientId: string, messageText: string, now: number, peer: string) => {
    if (!pubkey || !signer) return;
    setMsgStatus(s => ({ ...s, [clientId]: "sending" }));
    try {
      await fetchDMRelayList(peer, { force: true }).catch((e) => console.warn("[DM] fetchDMRelayList failed for contact:", e?.message));
      // NIP-17: recipient's wrap → THEIR relays only; self-copy → MY relays.
      const recipientRelays = getDMRelaysForContact(peer);
      const selfRelays = getMyDMReceiveRelays(pubkey);
      const recipientHas10050 = hasDMRelayList(peer);

      if (!recipientHas10050 && !no10050WarnedRef.current.has(peer)) {
        no10050WarnedRef.current.add(peer);
        toast({
          title: "No DM inbox relays found",
          description: "This user hasn't published a DM relay list (NIP-17). They may not receive this message.",
          variant: "default",
          duration: 5000,
        });
      }

      const emojiTags = buildEmojiTags(messageText, dmEmojiMap);
      const giftWrapResult = await createGiftWrap(signer, pubkey, peer, messageText, { rumorCreatedAt: now, extraTags: emojiTags });
      const wrapForSelf = await createGiftWrapForSelf(signer, pubkey, peer, messageText, { rumorCreatedAt: now, extraTags: emojiTags });
      if (!giftWrapResult) throw new Error("Failed to create encrypted message.");

      await publishWithFallback(recipientRelays, giftWrapResult.wrap, "gift-wrap-to-recipient", recipientHas10050);
      if (wrapForSelf) {
        publishWithFallback(selfRelays, wrapForSelf, "gift-wrap-for-self", true).catch((e) => console.warn("[DM] Self-wrap publish failed:", e));
      }

      const realId = giftWrapResult.rumorId;
      seenMessageIdsRef.current.add(realId);
      seenContentKeysRef.current.add(msgContentKey(pubkey, now, messageText));
      deliveredMsgIds.current.add(realId);
      // Swap the temp client id for the real rumor id so incoming echoes dedupe.
      setMessages(prev => prev.map(m => (m.id === clientId ? { ...m, id: realId } : m)));
      setMsgStatus(s => { const n = { ...s }; delete n[clientId]; return n; });

      const stored: DecodedMessage = { id: realId, content: messageText, from: pubkey, timestamp: now, encryption: "nip17" };
      appendCachedMessage(pubkey, peer, stored);
      dmCache.putMessage(pubkey, peer, {
        id: realId, ownerPubkey: pubkey, peerPubkey: peer,
        content: messageText, from: pubkey, timestamp: now, encryption: "nip17" }).catch((e) => console.warn("[DM] Cache putMessage failed:", e?.message));
      dmCache.putConversation(pubkey, {
        ownerPubkey: pubkey, peerPubkey: peer,
        lastMessage: messageText, lastTimestamp: now }).catch((e) => console.warn("[DM] Cache putConversation failed:", e?.message));
    } catch (err) {
      console.error("Send DM failed:", err);
      setMsgStatus(s => ({ ...s, [clientId]: "failed" }));
      const isRelayError = err instanceof AggregateError || (err instanceof Error && err.message.includes("All promises were rejected"));
      toast({
        title: "Message didn't send",
        description: isRelayError ? "Couldn't reach any relay — tap the message to retry." : (err instanceof Error ? err.message : "Couldn't encrypt or publish — tap to retry."),
        variant: "destructive" });
    }
  }, [pubkey, signer, toast, dmEmojiMap]);

  // Stickers/GIFs picked but not yet sent — shown as preview chips above the input
  // (instead of pasting a raw URL / :shortcode: into the text box). Appended to the
  // message text at send time so they render as media/emoji like any other content.
  const [pendingMedia, setPendingMedia] = useState<{ id: string; kind: "gif" | "sticker"; url: string; shortcode?: string }[]>([]);

  // Optimistic send: show the message immediately, clear the box so the user can
  // carry on, then deliver in the background and update its sent/failed state.
  const sendMessage = useCallback(() => {
    if (!pubkey || !signer || !selectedPubkey || (!newMessage.trim() && pendingMedia.length === 0)) return;
    if (!signer.nip44) {
      toast({ title: "NIP-44 Required", description: NIP44_REQUIRED_MSG, variant: "destructive" });
      return;
    }
    const mediaText = pendingMedia.map((p) => (p.kind === "gif" ? p.url : `:${p.shortcode}:`)).join("\n");
    const messageText = [newMessage.trim(), mediaText].filter(Boolean).join("\n");
    const now = Math.floor(Date.now() / 1000);
    const clientId = `pending-${now}-${Math.random().toString(36).slice(2, 9)}`;
    const peer = selectedPubkey;

    const optimistic: DecodedMessage = { id: clientId, content: messageText, from: pubkey, timestamp: now, encryption: "nip17" };
    seenContentKeysRef.current.add(msgContentKey(pubkey, now, messageText));
    setMessages(prev => [...prev, optimistic]);
    setNewMessage("");
    setPendingMedia([]);
    setConversations(prev => {
      const updated = prev.filter(c => c.pubkey !== peer);
      updated.unshift({ pubkey: peer, lastMessage: messageText, lastTimestamp: now, unread: false });
      return updated;
    });
    // Sending marks the thread read so your own message never shows as an unread DM.
    writeDmLastRead(peer, now);

    void deliverMessage(clientId, messageText, now, peer);
  }, [pubkey, signer, selectedPubkey, newMessage, pendingMedia, toast, deliverMessage]);

  const retryMessage = useCallback((msg: DecodedMessage) => {
    if (!selectedPubkey) return;
    void deliverMessage(msg.id, msg.content, msg.timestamp, selectedPubkey);
  }, [deliverMessage, selectedPubkey]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!pubkey || !signer || !selectedPubkey) return;
    if (!signer.nip44) {
      toast({ title: "NIP-44 Required", description: NIP44_REQUIRED_MSG, variant: "destructive" });
      return;
    }

    setUploading(true);
    setUploadStatus("Uploading...");
    try {
      // NIP-17 kind-15: AES-256-GCM encrypt the file client-side and upload the
      // CIPHERTEXT; the hex key/nonce ride inside the gift-wrapped rumor as
      // decryption tags. This is the interoperable shape (Amethyst & other spec
      // clients can decrypt it) AND keeps DM media private — the old path
      // uploaded plaintext and wrapped it as kind-15 with no key, which spec
      // clients reported as "could not decrypt".
      const fileRef = await encryptAndUploadDmFile(file, signer, setUploadStatus);
      const mimeType = fileRef.mime;

      await fetchDMRelayList(selectedPubkey, { force: true }).catch((e) => console.warn("[DM] fetchDMRelayList failed for contact:", e?.message));
      // NIP-17: recipient's wrap → THEIR relays only; self-copy → MY relays.
      const recipientRelays = getDMRelaysForContact(selectedPubkey);
      const selfRelays = getMyDMReceiveRelays(pubkey);
      const recipientHas10050 = hasDMRelayList(selectedPubkey);
      const now = Math.floor(Date.now() / 1000);

      const fileTags = buildFileMessageTags(fileRef);

      const giftWrapResult = await createGiftWrap(signer, pubkey, selectedPubkey, fileRef.url, { rumorCreatedAt: now, rumorKind: KIND_FILE_MESSAGE, extraTags: fileTags });
      const wrapForSelf = await createGiftWrapForSelf(signer, pubkey, selectedPubkey, fileRef.url, { rumorCreatedAt: now, rumorKind: KIND_FILE_MESSAGE, extraTags: fileTags });

      if (!giftWrapResult) {
        throw new Error("Failed to create encrypted file message.");
      }

      await publishWithFallback(recipientRelays, giftWrapResult.wrap, "file-wrap-to-recipient", recipientHas10050);
      if (wrapForSelf) {
        publishWithFallback(selfRelays, wrapForSelf, "file-wrap-for-self", true).catch((e) => {
          console.warn("[DM] Self-wrap publish failed:", e);
        });
      }

      const fileMeta: FileMetadata = {
        url: fileRef.url, mimeType, dim: fileRef.dim, size: fileRef.size, originalHash: fileRef.sha256,
        encAlgo: fileRef.algo, encKey: fileRef.key, encNonce: fileRef.nonce };
      const newMsg: DecodedMessage = {
        id: giftWrapResult.rumorId,
        content: fileRef.url,
        from: pubkey,
        timestamp: now,
        encryption: "nip17",
        fileMetadata: fileMeta };

      seenMessageIdsRef.current.add(newMsg.id);
      seenContentKeysRef.current.add(msgContentKey(newMsg.from, newMsg.timestamp, newMsg.content));
      deliveredMsgIds.current.add(newMsg.id);
      setMessages(prev => [...prev, newMsg]);
      appendCachedMessage(pubkey, selectedPubkey, newMsg);

      const previewText = mimeType?.startsWith("image") ? "📷 Image" : mimeType?.startsWith("video") ? "🎬 Video" : mimeType?.startsWith("audio") ? "🎵 Audio" : "📎 File";
      dmCache.putMessage(pubkey, selectedPubkey, {
        id: newMsg.id, ownerPubkey: pubkey, peerPubkey: selectedPubkey,
        content: newMsg.content, from: newMsg.from,
        timestamp: newMsg.timestamp, encryption: newMsg.encryption,
        fileMetadata: newMsg.fileMetadata }).catch((e) => console.warn("[DM] Cache putMessage failed:", e?.message));
      dmCache.putConversation(pubkey, {
        ownerPubkey: pubkey, peerPubkey: selectedPubkey,
        lastMessage: previewText, lastTimestamp: now }).catch((e) => console.warn("[DM] Cache putConversation failed:", e?.message));

      setConversations(prev => {
        const updated = prev.filter(c => c.pubkey !== selectedPubkey);
        updated.unshift({ pubkey: selectedPubkey, lastMessage: previewText, lastTimestamp: now, unread: false });
        return updated;
      });
      // Sending marks the thread read so your own message never shows as an unread DM.
      writeDmLastRead(selectedPubkey, now);

      toast({ title: "File sent" });
    } catch (err: any) {
      toast({ title: "File send failed", description: err.message || "Could not upload or send file", variant: "destructive" });
    } finally {
      setUploading(false);
      setUploadStatus("");
    }
  }, [pubkey, signer, selectedPubkey, toast]);

  const handleNewChat = useCallback(() => {
    const input = newChatInput.trim();
    if (!input) return;

    let targetPubkey: string | null = null;

    try {
      if (input.startsWith("npub1")) {
        const decoded = nip19.decode(input);
        if (decoded.type === "npub") {
          targetPubkey = decoded.data;
        }
      } else if (/^[0-9a-f]{64}$/i.test(input)) {
        targetPubkey = input.toLowerCase();
      }
    } catch {}

    if (!targetPubkey) {
      toast({ title: "Invalid address", description: "Enter a valid npub or hex pubkey.", variant: "destructive" });
      return;
    }

    if (targetPubkey === pubkey) {
      toast({ title: "Can't message yourself", variant: "destructive" });
      return;
    }

    setShowNewChat(false);
    setNewChatInput("");
    navigateToConversation(targetPubkey);
  }, [newChatInput, pubkey, toast, openConversation]);

  useEffect(() => {
    const query = newChatInput.trim();

    if (!query || query.startsWith("npub1") || /^[0-9a-f]{64}$/i.test(query)) {
      setUserSearchResults([]);
      setUserSearching(false);
      return;
    }

    const lowerQ = query.toLowerCase();

    const localResults: typeof userSearchResults = [];
    const seen = new Set<string>();

    if (follows?.length) {
      for (const pk of follows) {
        if (seen.size >= 8) break;
        const ev = getCachedProfile(pk);
        if (!ev) continue;
        const p = getProfileContent(ev);
        if (!p) continue;
        const match = [p.display_name, p.name, p.nip05].filter(Boolean).some(f => f!.toLowerCase().includes(lowerQ));
        if (match && !seen.has(pk)) {
          seen.add(pk);
          localResults.push({ pubkey: pk, name: p.name || "", displayName: p.display_name, picture: p.picture, nip05: p.nip05 });
        }
      }
    }

    const cached = searchCachedProfiles(lowerQ, 8);
    for (const ev of cached) {
      if (seen.size >= 8) break;
      const p = getProfileContent(ev);
      if (!p || seen.has(ev.pubkey)) continue;
      seen.add(ev.pubkey);
      localResults.push({ pubkey: ev.pubkey, name: p.name || "", displayName: p.display_name, picture: p.picture, nip05: p.nip05 });
    }

    setUserSearchResults(localResults);

    if (localResults.length < 4 && query.length >= 2) {
      setUserSearching(true);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(async () => {
        try {
          const remote = await searchUsers(query, 8);
          if (!mountedRef.current) return;
          const combined = [...localResults];
          for (const ev of remote) {
            if (combined.length >= 8) break;
            if (seen.has(ev.pubkey)) continue;
            const rp = getProfileContent(ev);
            if (!rp) continue;
            seen.add(ev.pubkey);
            combined.push({ pubkey: ev.pubkey, name: rp.name || "", displayName: rp.display_name, picture: rp.picture, nip05: rp.nip05 });
          }
          setUserSearchResults(combined);
        } catch {}
        setUserSearching(false);
      }, 300);
    }

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [newChatInput, follows]);

  const handleSelectSearchResult = useCallback((resultPubkey: string) => {
    if (resultPubkey === pubkey) {
      toast({ title: "Can't message yourself", variant: "destructive" });
      return;
    }
    setShowNewChat(false);
    setNewChatInput("");
    setUserSearchResults([]);
    navigateToConversation(resultPubkey);
  }, [pubkey, toast, openConversation]);

  const handleDeleteMessage = useCallback(async (msgId: string, isMine: boolean) => {
    addHiddenMessageId(msgId);
    setHiddenMsgIds(prev => { const s = new Set(Array.from(prev)); s.add(msgId); return s; });
    setMessages(prev => prev.filter(m => m.id !== msgId));

    if (isMine && signer && pubkey) {
      try {
        const deleteEvent = {
          kind: 5,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["e", msgId]],
          content: "" };
        const signed = await signWithTimeout(signer, deleteEvent);
        await publishEvent(signed as Event);
      } catch (err) {
        console.error("Failed to publish deletion event:", err);
      }
    }

    toast({ title: isMine ? "Message deleted" : "Message hidden" });
    setDeleteConfirm(null);
  }, [signer, pubkey, toast]);

  const handleDeleteConversation = useCallback((contactPubkey: string) => {
    addHiddenConvoPubkey(contactPubkey);
    setHiddenConvos(prev => { const s = new Set(Array.from(prev)); s.add(contactPubkey); return s; });
    setConversations(prev => prev.filter(c => c.pubkey !== contactPubkey));

    const cacheKey = pubkey ? getCacheKey(pubkey, contactPubkey) : null;
    if (cacheKey) {
      conversationCache.delete(cacheKey);
      conversationCacheTimestamps.delete(cacheKey);
    }

    toast({ title: "Conversation removed" });
    setDeleteConfirm(null);
  }, [pubkey, toast]);

  const handleRestoreConversation = useCallback((contactPubkey: string) => {
    removeHiddenConvoPubkey(contactPubkey);
    setHiddenConvos(prev => {
      const s = new Set(Array.from(prev));
      s.delete(contactPubkey);
      if (s.size === 0 && hiddenMsgIds.size === 0) setShowDeleted(false);
      return s;
    });
    setConversations(prev => {
      if (prev.find(c => c.pubkey === contactPubkey)) return prev;
      return [{
        pubkey: contactPubkey,
        lastMessage: "",
        lastTimestamp: Math.floor(Date.now() / 1000),
        unread: false }, ...prev];
    });
    toast({ title: "Conversation restored" });
  }, [toast, hiddenMsgIds.size]);

  const handleClearAllHidden = useCallback(() => {
    clearAllHiddenMessageIds();
    clearAllHiddenConvos();
    setHiddenMsgIds(new Set());
    setHiddenConvos(new Set());
    setShowDeleted(false);
    toast({ title: "All deleted items restored" });
  }, [toast]);

  const closeThread = useCallback(() => {
    liveSubRef.current?.close();
    liveSubRef.current = null;
    setSelectedPubkey(null);
    selectedPubkeyRef.current = null;
    setMessages([]);
    setDeleteConfirm(null);
    setIsDeletedPreview(false);
    window.dispatchEvent(new Event("dm-thread-close"));
    // Keep the URL in sync so back/refresh/deep-link stay coherent. If the
    // thread route is still active (the user tapped the in-app back control —
    // not a browser/native pop that already changed the URL), go back through
    // the shared helper so scroll restore fires exactly like the native gesture;
    // fall back to the inbox for a cold deep-link into a thread.
    if (window.location.pathname !== "/messages") goBack("/messages");
  }, [goBack]);

  // Private mode arming closes an open thread: a shielded list beside an open
  // conversation shields nothing (the biggest leak the grilling's leak-check
  // named). Fired by lib/private-mode.ts on every mask transition — the eye,
  // the standing setting turning on, and the background re-arm all funnel
  // through the same event.
  useEffect(() => {
    const onMasked = () => {
      if (selectedPubkeyRef.current) closeThread();
    };
    window.addEventListener("private-mode-masked", onMasked);
    return () => window.removeEventListener("private-mode-masked", onMasked);
  }, [closeThread]);

  useEffect(() => {
    const handler = ((e: CustomEvent) => {
      if (e.detail?.pubkey) {
        navigateToConversation(e.detail.pubkey);
      }
    }) as EventListener;
    window.addEventListener("open-dm", handler);
    return () => window.removeEventListener("open-dm", handler);
  }, [openConversation]);

  // A DM decrypted+cached by the notification path (which marks the wrap
  // processed so we won't re-decrypt it) — re-read the cache so it shows here
  // without needing to reopen, both in the inbox list and the open thread.
  useEffect(() => {
    // Debounced: a backfill burst dispatches a single coalesced event (detail.peers),
    // but guard anyway so multiple events → one loadConversations, not a storm.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pendingPeers = new Set<string>();
    const handler = ((e: CustomEvent) => {
      const peers: string[] = e.detail?.peers ?? (e.detail?.peerPubkey ? [e.detail.peerPubkey] : []);
      peers.forEach((p) => pendingPeers.add(p));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        loadConversations();
        // If the open thread got new messages, invalidate its in-memory cache so
        // the re-open reads IDB (which now has them) and refresh it once.
        if (pubkey && selectedPubkey && pendingPeers.has(selectedPubkey)) {
          markCacheStale(pubkey, selectedPubkey);
          openConversation(selectedPubkey);
        }
        pendingPeers.clear();
      }, 300);
    }) as EventListener;
    window.addEventListener("dm-cache-updated", handler);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("dm-cache-updated", handler);
    };
  }, [loadConversations, openConversation, selectedPubkey, pubkey]);

  // URL is the source of truth for the open thread (/messages/:npub).
  // Legacy ?to=npub deep-links redirect into that; the route param drives
  // which conversation is open, so back/refresh/share all work.
  useEffect(() => {
    if (!pubkey) return;
    const legacy = new URLSearchParams(window.location.search).get("to");
    if (legacy) {
      try {
        // REPLACE, not push: a push leaves the ?to= entry alive underneath the
        // thread, and this effect re-fires every time Back returns to it —
        // re-pushing the thread and turning Back into a trap you cannot leave.
        if (nip19.decode(legacy).type === "npub") { setLocation(`/messages/${legacy}`, { replace: true }); return; }
      } catch {}
    }
    const id = threadMatch?.id;
    if (id) {
      let hex: string | null = null;
      try { const d = nip19.decode(id); if (d.type === "npub") hex = d.data as string; } catch {}
      if (!hex && /^[0-9a-f]{64}$/i.test(id)) hex = id;
      if (hex && hex !== selectedPubkeyRef.current) openConversation(hex);
    } else if (selectedPubkeyRef.current) {
      closeThread();
    }
  }, [pubkey, threadMatch?.id, openConversation, closeThread, setLocation]);

  const followsSet = useMemo(() => new Set(follows), [follows]);

  useEffect(() => {
    if (pubkey) {
      setPromotedPrimary(getPromotedPrimary(pubkey));
      setDemotedToRequests(getDemotedToRequests(pubkey));
    } else {
      setPromotedPrimary(new Set());
      setDemotedToRequests(new Set());
    }
    setInitiatedByMe(new Set());
  }, [pubkey]);

  const checkedInitiatedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    checkedInitiatedRef.current.clear();
  }, [pubkey]);

  useEffect(() => {
    if (!pubkey || conversations.length === 0) return;
    const toCheck = conversations
      .filter(c => !initiatedByMe.has(c.pubkey) && !checkedInitiatedRef.current.has(c.pubkey) && !followsSet.has(c.pubkey) && !promotedPrimary.has(c.pubkey))
      .map(c => c.pubkey);
    if (toCheck.length === 0) return;

    let cancelled = false;
    (async () => {
      const found: string[] = [];
      for (const peer of toCheck) {
        if (cancelled) break;
        checkedInitiatedRef.current.add(peer);
        try {
          const msgs = await dmCache.getMessages(pubkey, peer);
          if (msgs.length > 0 && msgs[0].from === pubkey) {
            found.push(peer);
          }
        } catch {}
      }
      if (!cancelled && found.length > 0) {
        setInitiatedByMe(prev => {
          const next = new Set(prev);
          for (const pk of found) next.add(pk);
          return next;
        });
      }
    })();
    return () => { cancelled = true; };
  }, [pubkey, conversations, followsSet, promotedPrimary]);

  const isPrimaryConversation = useCallback((peerPubkey: string): boolean => {
    if (demotedToRequests.has(peerPubkey)) return false;
    if (promotedPrimary.has(peerPubkey)) return true;
    if (followsSet.has(peerPubkey)) return true;
    if (followedByPubkeys?.has(peerPubkey)) return true;
    const tier = getAuthorTier(peerPubkey);
    if (tier === "strong" || tier === "moderate") return true;
    if (initiatedByMe.has(peerPubkey)) return true;
    return false;
  }, [demotedToRequests, promotedPrimary, followsSet, followedByPubkeys, getAuthorTier, initiatedByMe]);

  const { primaryConversations, requestConversations } = useMemo(() => {
    let list = conversations.filter(c => !hiddenConvos.has(c.pubkey));
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      list = list.filter(c => {
        const p = profiles.get(c.pubkey) || null;
        const name = getDMDisplayName(p, c.pubkey).toLowerCase();
        return name.includes(q) || c.lastMessage.toLowerCase().includes(q);
      });
    }
    const primary: ConversationPreview[] = [];
    const requests: ConversationPreview[] = [];
    for (const conv of list) {
      if (isPrimaryConversation(conv.pubkey)) {
        primary.push(conv);
      } else {
        requests.push(conv);
      }
    }
    return { primaryConversations: primary, requestConversations: requests };
  }, [conversations, hiddenConvos, searchFilter, profiles, isPrimaryConversation]);

  const activeConversations = dmTab === "primary" ? primaryConversations : requestConversations;

  // Concord group chats join the Primary list (Signal/WhatsApp model): one
  // recency-sorted list of DMs + groups. Requests stays DM-only — group
  // membership is explicit, so a group has no "request" state.
  const { groups: groupChats, reload: reloadGroupChats, concordEnabled } = useGroupChats(pubkey);
  const concordUnread = useConcordUnread();
  const concordActivity = useConcordActivity();
  // Per-channel unread MENTIONS (read-pruned + mute-filtered) — the only
  // number a group row shows; also picks which channel a tap lands on.
  const concordMentions = useConcordMentionCounts();
  // Every group shows the SAME shared name + a facepile avatar to all members
  // (no per-viewer person-presentation) — resolved here from the roster.
  const groupIdentities = useGroupIdentities(groupChats, pubkey);
  // Decrypted last-message teasers (local cache only) + the privacy toggle
  // that swaps EVERY preview — DM and group alike — for a generic line.
  const groupTeasers = useGroupTeasers(groupChats, pubkey, concordActivity);
  const hidePreviews = useHideMessagePreviews();
  // Re-render on petname edits so the thread header and list pick up a rename
  // in the same tick it is saved.
  usePetnamesVersion();

  // While you're reading one conversation the bottom nav is hidden, which takes
  // its unread badge with it — so a message landing in ANOTHER chat was
  // completely silent (the bell deliberately excludes DMs, and there are no web
  // notifications). This is the banner every messaging app shows in that moment:
  // who it was from, tap to jump, dismissable, and gone when you leave.
  const threadOpenedAt = useRef(0);
  const [otherChatAlert, setOtherChatAlert] = useState<string | null>(null);
  const dismissedAlerts = useRef<Set<string>>(new Set());
  useEffect(() => {
    threadOpenedAt.current = Math.floor(Date.now() / 1000);
    dismissedAlerts.current = new Set();
    setOtherChatAlert(null);
  }, [selectedPubkey]);
  useEffect(() => {
    if (!selectedPubkey) return;
    const newest = conversations
      .filter((c) => c.pubkey !== selectedPubkey
        && c.lastTimestamp > threadOpenedAt.current
        && !dismissedAlerts.current.has(c.pubkey))
      .sort((a, b) => b.lastTimestamp - a.lastTimestamp)[0];
    if (newest) setOtherChatAlert(newest.pubkey);
  }, [conversations, selectedPubkey]);
  const alertProfile = otherChatAlert ? profiles.get(otherChatAlert) : undefined;
  const alertName = otherChatAlert
    ? getDMDisplayName(alertProfile ?? null, otherChatAlert)
    : "";
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const groupPreviews = useMemo<GroupPreview[]>(() => groupChats.map((c) => {
    const id = groupIdentities.get(c.community_id);
    const channelIds = c.channels.map((ch) => ch.id);
    const mentionFor = (chid: string) => concordMentions.get(mentionKey(c.community_id, chid)) ?? 0;
    // Per-channel unread from the metadata wrap clock vs read marks, minus
    // muted channels — feeds the first-unread-channel tap target only (the
    // row's dot still comes from the shared community-level unread set).
    const unreadChannels = computeUnreadChannels(channelIds, getChannelWrapTimes(c.community_id), (chid) => readChannelLastRead(c.community_id, chid));
    for (const chid of [...unreadChannels]) if (isMuted(c.community_id, chid)) unreadChannels.delete(chid);
    return {
      communityId: c.community_id,
      name: id?.name ?? c.name,
      icon: c.icon,
      channelCount: c.channels.length,
      // Activity clock (ms) floored by addedAt so a brand-new / never-seeded
      // group still sorts by when you joined it instead of pinning to epoch 0.
      lastActivity: Math.max(concordActivity.get(c.community_id) ?? 0, getConcordLastActivity(c.community_id), c.addedAt),
      unread: concordUnread.has(c.community_id),
      mentions: channelIds.reduce((n, chid) => n + mentionFor(chid), 0),
      muted: isCommunityMuted(c.community_id),
      firstUnreadChannelId: pickFirstUnreadChannel(channelIds, unreadChannels, mentionFor),
      members: id?.members ?? [],
      memberNames: id?.memberNames ?? [],
      teaser: hidePreviews ? undefined : groupTeasers.get(c.community_id)?.teaser,
      // The channel the teaser is from — a tap opens THAT channel + its latest.
      teaserChannelId: groupTeasers.get(c.community_id)?.channelId,
      // Does this space have a public front door? Present ⇒ it is relay-backed
      // and a stranger with a link can arrive; absent ⇒ private and invite-only.
      // That is the entire Groups/Communities split (see isCommunityEntry).
      relayUrl: c.relayUrl,
    };
  }), [groupChats, concordActivity, concordUnread, concordMentions, groupIdentities, groupTeasers, hidePreviews]);
  const chatEntries = useMemo(
    () => mergeChatEntries(activeConversations, groupPreviews, { tab: dmTab, searchFilter }),
    [activeConversations, groupPreviews, dmTab, searchFilter],
  );

  const { requestUnreadCount, totalRequestCount } = useMemo(() => {
    const allVisible = conversations.filter(c => !hiddenConvos.has(c.pubkey));
    let unread = 0;
    let total = 0;
    for (const c of allVisible) {
      if (!isPrimaryConversation(c.pubkey)) {
        total++;
        if (c.unread) unread++;
      }
    }
    return { requestUnreadCount: unread, totalRequestCount: total };
  }, [conversations, hiddenConvos, isPrimaryConversation]);

  useEffect(() => {
    if (!pubkey || conversations.length === 0) return;
    const pks = conversations.map(c => c.pubkey);
    // Shared pipeline: global batch prewarm (provisional) + per-observer
    // refinement. Injecting the raw global batch here used to mark those
    // values authoritative and wrote sticky -1 "No data" markers for misses.
    requestScoresBulk(pks);
  }, [pubkey, conversations, requestScoresBulk]);

  const handlePromoteToPrimary = useCallback((peerPubkey: string) => {
    if (!pubkey) return;
    const ownerPk = pubkey;
    setPromotedPrimary(prev => {
      const next = new Set(prev);
      next.add(peerPubkey);
      savePromotedPrimary(ownerPk, next);
      return next;
    });
    setDemotedToRequests(prev => {
      if (!prev.has(peerPubkey)) return prev;
      const next = new Set(prev);
      next.delete(peerPubkey);
      saveDemotedToRequests(ownerPk, next);
      return next;
    });
    toast({ title: "Moved to Primary" });
  }, [pubkey, toast]);

  const handleDemoteToRequests = useCallback((peerPubkey: string) => {
    if (!pubkey) return;
    const ownerPk = pubkey;
    setDemotedToRequests(prev => {
      const next = new Set(prev);
      next.add(peerPubkey);
      saveDemotedToRequests(ownerPk, next);
      return next;
    });
    setPromotedPrimary(prev => {
      if (!prev.has(peerPubkey)) return prev;
      const next = new Set(prev);
      next.delete(peerPubkey);
      savePromotedPrimary(ownerPk, next);
      return next;
    });
    toast({ title: "Moved to Requests" });
  }, [pubkey, toast]);

  const visibleMessages = useMemo(() => {
    const seen = new Set<string>();
    return messages.filter(m => {
      if (hiddenMsgIds.has(m.id)) return false;
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, [messages, hiddenMsgIds]);

  const prevMsgCountRef = useRef(0);
  const shouldAnimateLast = visibleMessages.length > prevMsgCountRef.current && prevMsgCountRef.current > 0;
  useEffect(() => {
    prevMsgCountRef.current = visibleMessages.length;
  }, [visibleMessages.length]);

  const messageRenderItems = useMemo((): MessageRenderItem[] => {
    const items: MessageRenderItem[] = [];
    let lastDateKey = "";
    let lastFrom = "";
    let lastTs = 0;
    let unreadShown = false;
    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      const d = new Date(msg.timestamp * 1000);
      const dateKey = d.toDateString();
      if (dateKey !== lastDateKey) {
        items.push({ type: "date-separator", label: formatDateSeparator(msg.timestamp), key: `date-${dateKey}` });
        lastDateKey = dateKey;
        lastFrom = "";
        lastTs = 0;
      }
      if (!unreadShown && unreadAnchorTs > 0 && msg.timestamp > unreadAnchorTs && msg.from !== pubkey) {
        items.push({ type: "unread", key: "dm-unread-divider" });
        unreadShown = true;
        lastFrom = "";
      }
      const sameCluster = msg.from === lastFrom && (msg.timestamp - lastTs) < 300;
      const next = visibleMessages[i + 1];
      const nextSameDate = next ? new Date(next.timestamp * 1000).toDateString() === dateKey : false;
      const nextInCluster = next && next.from === msg.from && (next.timestamp - msg.timestamp) < 300 && nextSameDate;
      items.push({
        type: "message",
        msg,
        showTimestamp: !nextInCluster,
        isClusterStart: !sameCluster,
        isMine: msg.from === pubkey });
      lastFrom = msg.from;
      lastTs = msg.timestamp;
    }
    return items;
  }, [visibleMessages, pubkey, unreadAnchorTs]);

  // Mark the open thread read as you view it — advances the stored last-read so the
  // next open shows the "Unread" divider only above genuinely-new messages.
  useEffect(() => {
    if (!selectedPubkey || messages.length === 0) return;
    const latest = messages[messages.length - 1]?.timestamp || 0;
    if (latest) writeDmLastRead(selectedPubkey, latest);
  }, [selectedPubkey, messages]);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [longPressTarget, setLongPressTarget] = useState<{ id: string; isMine: boolean } | null>(null);

  const handleLongPressStart = useCallback((msgId: string, isMine: boolean) => {
    longPressTimerRef.current = setTimeout(() => {
      setLongPressTarget({ id: msgId, isMine });
      if (navigator.vibrate) navigator.vibrate(50);
    }, 300);
  }, []);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
  }, []);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, [selectedPubkey]);

  const deliveredMsgIds = useRef<Set<string>>(new Set());
  const no10050WarnedRef = useRef<Set<string>>(new Set());

  if (!pubkey) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 py-16" data-testid="page-messages">
        <MessagesIcon className="w-12 h-12 text-muted-foreground/50 mb-4" />
        <h2 className="text-lg font-medium mb-1">Sign in to message</h2>
        <p className="text-sm text-muted-foreground text-center mb-4">
          Connect your Nostr identity to send and receive private messages
        </p>
        <Button onClick={() => setLocation("/login")} data-testid="button-messages-login">
          Sign In
        </Button>
      </div>
    );
  }

  const contactProfile = selectedPubkey ? (profiles.get(selectedPubkey) || null) : null;
  // Petname wins in the thread header too — one surface showing your name and
  // another the real one would read as two different people. The real name
  // stays one tap away on the profile.
  const contactName = selectedPubkey
    ? displayNameWith("person", selectedPubkey, getDMDisplayName(contactProfile, selectedPubkey))
    : "";

  return (
    <>
    {/* Fill <main>'s viewport EXACTLY (same formula as ConcordOutpost): main has
        pt 4.25rem+safe-top and pb 7rem+safe-bottom on mobile, so the page height
        must subtract BOTH or the page itself becomes scrollable inside <main> —
        which is what let the list slide under the fixed top bar and left a ghost
        gap above the bottom nav. Only the inner lists scroll. */}
    <div className="flex h-[calc(100svh-4.25rem-7rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] md:h-[calc(100dvh-5rem)]" data-testid="page-messages">
      <div className={`flex flex-col w-full md:w-[320px] md:shrink-0 md:border-r md:border-foreground/15 dark:md:border-white/15 ${selectedPubkey ? "hidden md:flex" : "flex"}`}>
        <ChatList
          pubkey={pubkey}
          signer={signer}
          conversations={conversations}
          entries={chatEntries}
          groupCount={groupPreviews.length}
          hidden={!!selectedPubkey}
          onReloadGroups={reloadGroupChats}
          canCreateGroup={concordEnabled}
          onNewGroupChat={() => setCreateGroupOpen(true)}
          onOpenGroup={(communityId, channelId) => setLocation(channelId
            ? `/outposts/c/${communityId}?channel=${encodeURIComponent(channelId)}`
            : `/outposts/c/${communityId}`)}
          profiles={profiles}
          hidePreviews={hidePreviews}
          selectedPubkey={selectedPubkey}
          dmTab={dmTab}
          setDmTab={setDmTab}
          requestUnreadCount={requestUnreadCount}
          totalRequestCount={totalRequestCount}
          loading={loading}
          loadingTooLong={loadingTooLong}
          loadConversations={loadConversations}
          searchFilter={searchFilter}
          setSearchFilter={setSearchFilter}
          showNewChat={showNewChat}
          setShowNewChat={setShowNewChat}
          showQrScan={showQrScan}
          setShowQrScan={setShowQrScan}
          showJoinLink={showJoinLink}
          setShowJoinLink={setShowJoinLink}
          newChatInput={newChatInput}
          setNewChatInput={setNewChatInput}
          handleNewChat={handleNewChat}
          userSearchResults={userSearchResults}
          setUserSearchResults={setUserSearchResults}
          userSearching={userSearching}
          handleSelectSearchResult={handleSelectSearchResult}
          pendingDecryptCount={pendingDecryptCount}
          decrypting={decrypting}
          decryptPending={decryptPending}
          showDeleted={showDeleted}
          setShowDeleted={setShowDeleted}
          hiddenConvos={hiddenConvos}
          hiddenMsgIds={hiddenMsgIds}
          onPreviewDeletedConversation={(cpk) => {
            setIsDeletedPreview(true);
            openConversation(cpk, true);
          }}
          handleRestoreConversation={handleRestoreConversation}
          onRestoreAllHiddenMessages={() => {
            clearAllHiddenMessageIds();
            setHiddenMsgIds(new Set());
            if (hiddenConvos.size === 0) setShowDeleted(false);
            toast({ title: "Hidden messages restored" });
          }}
          handleClearAllHidden={handleClearAllHidden}
          navigateToConversation={navigateToConversation}
          onOpenProfile={(pk) => setLocation(`/profile/${nip19.npubEncode(pk)}`)}
          handlePromoteToPrimary={handlePromoteToPrimary}
          handleDemoteToRequests={handleDemoteToRequests}
          onRemoveConversation={(pk) => setDeleteConfirm({ type: "conversation", id: pk })}
        />
      </div>

      {selectedPubkey ? (
        // Mobile: full-screen fixed overlay so the thread is immune to <main>'s
        // safe-area padding / scroll quirks that made it render off-screen on PWA
        // (Safari/Chrome/DDG) until you rotated to the wider two-pane layout.
        // It canNOT sit above the app header, despite z-[55]: <main> is
        // `relative z-0`, which opens a stacking context that clamps us inside
        // it, while the header is a SIBLING at z-50. Without the top pad below,
        // the header painted straight over this row — the back button, the
        // contact's avatar and their name were all invisible and untappable, so
        // the only way out of a thread was the generic app-header arrow (which
        // falls back to the Feed). Same trap, same fix, as ConcordOutpost.
        <div className="flex flex-col min-w-0 min-h-0 fixed inset-0 z-[55] bg-background pt-[calc(4.25rem+env(safe-area-inset-top,0px))] md:relative md:inset-auto md:z-auto md:bg-transparent md:pt-0 md:flex-1 md:!h-auto md:!bottom-0" style={threadHeight ? { height: `${threadHeight}px`, top: `${kbOffsetTop}px`, bottom: "auto" } : undefined} data-testid="page-messages-thread">
          <div className="flex items-center gap-3 p-3 border-b border-border/40 shrink-0">
            {/* md:hidden — embedded-mode chrome must not leak into the
                master-detail layout (owner report: "two back buttons"). On
                desktop the chat list is visible RIGHT THERE; nobody needs
                "back to the list" when the list never left, and the app
                header's own back already sits directly above this one. On
                mobile the thread is full-screen and this arrow is the way out.
                Slack/Discord/iMessage desktop: no back in the thread header. */}
            <Button
              variant="ghost"
              size="icon"
              onClick={closeThread}
              className="h-11 w-11 shrink-0 md:hidden"
              aria-label="Back to chats"
              title="Back to chats"
              data-testid="button-thread-back"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <button
              onClick={() => setLocation(`/profile/${nip19.npubEncode(selectedPubkey)}`)}
              className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer hover:opacity-80 transition-opacity"
              data-testid="button-thread-profile"
            >
              <Avatar className="w-8 h-8 border border-border shrink-0">
                <AvatarImage src={contactProfile?.picture} alt={contactName} />
                <AvatarFallback className="text-xs bg-muted text-muted-foreground">
                  {contactName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate flex items-center gap-1.5" data-testid="text-thread-contact-name">
                  <span className="truncate">{contactName}</span>
                  {/* Claimed name only — contactName can be an npub fallback, and
                      comparing an npub against trusted names is noise. */}
                  <PersonBadges
                    pubkey={selectedPubkey}
                    nip05={contactProfile?.nip05}
                    claimedName={contactProfile?.display_name || contactProfile?.name}
                  />
                </p>
              </div>
            </button>
            {isDeletedPreview && (
              <span className="text-[10px] bg-muted text-muted-foreground rounded-full px-2 py-0.5 shrink-0">Deleted</span>
            )}
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 shrink-0" data-testid="text-encryption-status">
              <ShieldCheck className="w-3 h-3 text-green-500/70" />
              <span>NIP-17</span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  aria-label="Conversation options"
                  data-testid="button-thread-menu"
                >
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    if (!selectedPubkey) return;
                    if (threadMuted) { unmutePubkey(selectedPubkey); setThreadMuted(false); }
                    else { mutePubkey(selectedPubkey); setThreadMuted(true); }
                  }}
                  className={`gap-2.5 cursor-pointer min-h-11 sm:min-h-0 ${threadMuted ? "" : "text-red-500 focus:text-red-500"}`}
                  data-testid="menu-item-thread-mute"
                >
                  <VolumeX className="w-4 h-4" /> {threadMuted ? "Unmute" : "Mute"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setShowThreadReport(true)}
                  className="gap-2.5 cursor-pointer min-h-11 sm:min-h-0 text-red-500 focus:text-red-500"
                  data-testid="menu-item-thread-report"
                >
                  <Flag className="w-4 h-4" /> Report
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Same person-report shape Profile uses: a kind-0 stub carrying
                the contact's pubkey — ReportDialog emits the p-tag report.
                DM content itself is E2EE and never leaves the thread. */}
            {selectedPubkey && (
              <ReportDialog
                open={showThreadReport}
                onOpenChange={setShowThreadReport}
                event={{ id: "", pubkey: selectedPubkey, kind: KIND_METADATA, content: "", created_at: 0, tags: [], sig: "" } as Event}
              />
            )}
          </div>

          {otherChatAlert && (
            <button
              onClick={() => { setOtherChatAlert(null); navigateToConversation(otherChatAlert); }}
              className="flex items-center gap-2.5 mx-3 mt-2 px-3 min-h-11 rounded-xl border border-primary/25 bg-primary/10 text-left"
              data-testid="other-chat-alert"
            >
              <MessageCircle className="w-4 h-4 shrink-0 text-brand" />
              <span className="min-w-0 flex-1 text-xs">
                <span className="font-medium text-foreground">{alertName}</span>
                <span className="text-muted-foreground"> sent you a message</span>
              </span>
              <span
                role="button"
                tabIndex={0}
                aria-label="Dismiss"
                onClick={(e) => { e.stopPropagation(); if (otherChatAlert) dismissedAlerts.current.add(otherChatAlert); setOtherChatAlert(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setOtherChatAlert(null); } }}
                className="shrink-0 w-8 h-8 -mr-1 flex items-center justify-center rounded-full text-muted-foreground/60"
              >
                <X className="w-3.5 h-3.5" />
              </span>
            </button>
          )}

          {/* Problem-only delivery-health banner: renders nothing for healthy
              threads; warns when the recipient has no published kind-10050 DM
              inbox (or, rarely, when our own auto-publish failed). */}
          {pubkey && (
            <DmDeliveryHealth
              myPubkey={pubkey}
              contactPubkey={selectedPubkey}
              contactName={contactName}
              selfAutopubFailed={selfAutopubFailed}
              onPublishInbox={handlePublishOwnInbox}
            />
          )}

          <div ref={messagesContainerRef} onScroll={onDmMessagesScroll} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-4 flex flex-col" data-testid="container-messages">
            {/* Desktop: cap the thread to a readable measure and center it in the
                filled pane (the pane + composer still span full width). Mobile
                (<md) is unchanged — full width, no centering. */}
            <div className="flex flex-1 flex-col min-h-0 w-full md:max-w-[46rem] md:mx-auto">
            <div className="flex-1" />
            {threadLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <RelayOutpostLoader size="md" label="Loading messages..." />
              </div>
            ) : visibleMessages.length === 0 ? (
              <div className="text-center py-12">
                <MessagesIcon className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No messages yet</p>
                <p className="text-xs text-muted-foreground/80">Send the first message to start the conversation</p>
              </div>
            ) : (
              messageRenderItems.map((item, idx) => {
                if (item.type === "date-separator") {
                  return (
                    <div key={item.key} className="dm-date-separator my-2">
                      <span className="text-[10px] font-medium text-muted-foreground/60 whitespace-nowrap">{item.label}</span>
                    </div>
                  );
                }
                if (item.type === "unread") {
                  return (
                    <div key={item.key} data-dm-unread-divider className="flex items-center gap-2 my-2 px-1">
                      <div className="flex-1 h-px bg-brand/30" />
                      <span className="text-[10px] font-semibold text-brand/80 uppercase tracking-wider whitespace-nowrap">Unread</span>
                      <div className="flex-1 h-px bg-brand/30" />
                    </div>
                  );
                }
                const { msg, showTimestamp, isClusterStart, isMine } = item;
                const isLastItem = idx === messageRenderItems.length - 1;
                const animateThis = isLastItem && shouldAnimateLast;
                return (
                  <div
                    key={msg.id}
                    className={`group flex items-end gap-1.5 ${isMine ? "justify-end" : "justify-start"} ${isClusterStart ? "mt-3" : "mt-0.5"} ${animateThis ? "dm-msg-enter" : ""}`}
                    data-testid={`message-${msg.id}`}
                    onTouchStart={() => !isDeletedPreview && handleLongPressStart(msg.id, isMine)}
                    onTouchEnd={handleLongPressEnd}
                    onTouchMove={handleLongPressEnd}
                  >
                    {isMine && !isDeletedPreview && (
                      <button
                        className="opacity-0 group-hover:opacity-100 group-active:opacity-60 focus:opacity-100 transition-opacity p-1 text-muted-foreground/50 cursor-pointer shrink-0 mb-1 hidden md:block"
                        onClick={() => setDeleteConfirm({ type: "message", id: msg.id, isMine: true })}
                        data-testid={`button-delete-msg-${msg.id}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                    {!isMine && (
                      isClusterStart ? (
                        <button
                          onClick={() => selectedPubkey && setLocation(`/profile/${nip19.npubEncode(selectedPubkey)}`)}
                          className="shrink-0 mb-0.5 cursor-pointer hover:ring-2 hover:ring-brand/50 rounded-full transition-all"
                        >
                          <Avatar className="w-6 h-6 md:w-7 md:h-7 border border-border/60">
                            <AvatarImage src={contactProfile?.picture} alt={contactName} />
                            <AvatarFallback className="text-[9px] bg-muted text-muted-foreground">
                              {contactName.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        </button>
                      ) : (
                        <div className="w-6 md:w-7 shrink-0" />
                      )
                    )}
                    <div
                      className={`max-w-[85%] sm:max-w-[560px] rounded-xl px-3.5 py-2.5 border ${
                        isMine ? "glass-bubble-own" : "glass-bubble-other"
                      }`}
                    >
                      {msg.quotedNoteId && (
                        <div className="mb-1.5">
                          <p className={`text-[11px] mb-1 flex items-center gap-1 ${isMine ? "text-[#c9b8ff]" : "text-muted-foreground/70"}`}>
                            <Lock className="w-2.5 h-2.5 shrink-0" />
                            {isMine ? "You replied privately" : "Replied privately to your post"}
                          </p>
                          <EmbeddedNote eventId={msg.quotedNoteId} encoded={nip19.noteEncode(msg.quotedNoteId)} />
                        </div>
                      )}
                      <DMMessageContent content={msg.content} userPubkey={pubkey} fileMetadata={msg.fileMetadata} isMine={isMine} />
                      {showTimestamp && (
                        <p className="text-[10px] mt-1 opacity-40 flex items-center gap-1">
                          {formatFullTime(msg.timestamp)}
                          {isMine && (
                            msgStatus[msg.id] === "sending" ? (
                              <Clock className="w-3 h-3 text-muted-foreground/40" aria-label="Sending" />
                            ) : msgStatus[msg.id] === "failed" ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); retryMessage(msg); }}
                                className="inline-flex items-center text-red-500/80 hover:text-red-500 transition-colors"
                                title="Didn't send — tap to retry"
                                data-testid={`button-retry-${msg.id}`}
                              >
                                <AlertCircle className="w-3 h-3" />
                              </button>
                            ) : deliveredMsgIds.current.has(msg.id) ? (
                              <Check className="w-3 h-3 text-green-500/70" aria-label="Sent" />
                            ) : null
                          )}
                        </p>
                      )}
                    </div>
                    {!isMine && !isDeletedPreview && (
                      <button
                        className="opacity-0 group-hover:opacity-100 group-active:opacity-60 focus:opacity-100 transition-opacity p-1 text-muted-foreground/50 cursor-pointer shrink-0 mb-1 hidden md:block"
                        onClick={() => setDeleteConfirm({ type: "message", id: msg.id, isMine: false })}
                        data-testid={`button-hide-msg-${msg.id}`}
                      >
                        <EyeOff className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
            </div>{/* /desktop reading-width cap */}
          </div>

          {longPressTarget && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center md:hidden"
              onClick={() => setLongPressTarget(null)}
            >
              <div className="absolute inset-0 bg-black/10" />
              <div
                className="relative rounded-xl border border-border/40 bg-background/95 backdrop-blur-md shadow-xl overflow-hidden min-w-[190px]"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => {
                    setDeleteConfirm({ type: "message", id: longPressTarget.id, isMine: longPressTarget.isMine });
                    setLongPressTarget(null);
                  }}
                >
                  {longPressTarget.isMine ? <Trash2 className="w-4 h-4 text-destructive" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                  <span className="text-sm font-medium">{longPressTarget.isMine ? "Delete message" : "Hide message"}</span>
                </button>
                <div className="border-t border-border/20" />
                <button
                  className="w-full px-4 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => setLongPressTarget(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Scrolled up? Offer the way back instead of yanking (Concord parity). */}
          {!dmAtBottom && messages.length > 0 && (
            <button
              onClick={() => { dmAtBottomRef.current = true; setDmAtBottom(true); scrollToBottom(); }}
              className="absolute bottom-[76px] right-3 z-10 flex items-center gap-1.5 h-8 px-3 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:opacity-90 transition-opacity"
              data-testid="dm-jump-latest"
            >
              Latest
              <ChevronDown className="w-4 h-4" />
            </button>
          )}

          {isDeletedPreview ? (
            <div className="p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] md:pb-3 border-t border-border/40 shrink-0">
              <div className="flex items-center gap-2 w-full md:max-w-[46rem] md:mx-auto">
                <p className="text-xs text-muted-foreground flex-1">This conversation was removed. Restore it to reply.</p>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    if (selectedPubkey) {
                      handleRestoreConversation(selectedPubkey);
                      setIsDeletedPreview(false);
                    }
                  }}
                  data-testid="button-restore-from-preview"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  Restore
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] md:pb-3 border-t border-border/40 shrink-0">
              <div className="w-full md:max-w-[46rem] md:mx-auto">
              {uploading && (
                <div className="flex items-center gap-2 px-2 pb-2 text-[11px] text-muted-foreground/70">
                  <RelayOutpostInlineLoader className="w-3 h-3" />
                  <span>{uploadStatus || "Uploading..."}</span>
                </div>
              )}
              {pendingMedia.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2" data-testid="dm-pending-media">
                  {pendingMedia.map((p) => (
                    <div key={p.id} className="relative">
                      <img src={p.url} alt={p.shortcode || "attachment"} className="h-14 w-14 rounded-md object-cover border border-border/40" loading="lazy" />
                      <button
                        type="button"
                        onClick={() => setPendingMedia(prev => prev.filter(x => x.id !== p.id))}
                        className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-xs leading-none text-muted-foreground hover:text-foreground"
                        aria-label="Remove attachment"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,audio/*,video/*"
                  className="hidden"
                  onChange={handleFileUpload}
                  data-testid="input-file-upload"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  data-testid="button-attach-media"
                >
                  {uploading ? (
                    <RelayOutpostInlineLoader className="w-4 h-4" />
                  ) : (
                    <Paperclip className="w-4 h-4" />
                  )}
                </Button>
                <div className="shrink-0">
                  <ComposeEmojiPicker
                    onInsert={(text, emoji) => {
                      // Custom emoji / stickers → preview chip; plain unicode emoji → type into the box.
                      if (emoji) {
                        setPendingMedia(prev => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind: "sticker", url: emoji.url, shortcode: emoji.shortcode }]);
                      } else {
                        setNewMessage(prev => prev + text);
                      }
                    }}
                    onGifSelect={(url) => setPendingMedia(prev => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind: "gif", url }])}
                  />
                </div>
                <AutoGrowTextarea
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends; Shift+Enter (and the mobile return key) makes a
                    // newline — the X / iMessage convention.
                    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  enterKeyHint={isMobile ? "enter" : "send"}
                  data-testid="input-message-compose"
                />
                <Button
                  size="icon"
                  onClick={sendMessage}
                  disabled={!newMessage.trim() && pendingMedia.length === 0}
                  data-testid="button-send-message"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
              </div>{/* /composer reading-width cap */}
            </div>
          )}
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center p-8 relative overflow-hidden">
          {/* Ambient space backdrop (desktop only) — same low-opacity image +
              gradient-scrim treatment as create-bg, so the card stays legible in
              both themes. Single static image, GPU-cheap. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <img
              src={messagesEmptyBg}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover object-center opacity-[0.10] dark:opacity-[0.22]"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/70 to-background/95" />
            <div className="absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_70%_100%_at_50%_0%,rgba(139,92,246,0.10),transparent_70%)] dark:bg-[radial-gradient(ellipse_70%_100%_at_50%_0%,rgba(139,92,246,0.18),transparent_70%)]" />
          </div>
          <div className="glass-card w-full max-w-md rounded-2xl border border-brand/15 dark:border-brand/10 px-8 py-10 text-center shadow-sm">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-brand/20 dark:border-brand/15 bg-brand/5 dark:bg-white/[0.03]">
              <MessagesIcon className="h-8 w-8 text-brand/70" />
            </div>
            <h2 className="text-base font-semibold text-foreground/90">Your messages</h2>
            <p className="mx-auto mt-1.5 max-w-[18rem] text-sm text-muted-foreground/70">
              Private, end-to-end encrypted. Start a new conversation.
            </p>
            {/* Rendered from the SAME list as ChatList's dropdown, sheet and
                empty state. This card used to hand-write its own copy — which
                is how it ended up the one surface of four with no
                Find-a-community, on the widest screen with the most room. */}
            <div className="mx-auto mt-6 flex w-full max-w-sm flex-col gap-2 text-left">
              {buildCreateActions({
                canCreateGroup: concordEnabled,
                onNewChat: () => setShowNewChat(true),
                onNewGroup: () => setCreateGroupOpen(true),
                onJoinLink: () => setShowJoinLink(true),
                onScanQr: () => setShowQrScan(true),
                onFindCommunity: () => setLocation("/outposts"),
              }).map(({ key, testId, Icon, label, desc, run }) => (
                <button
                  key={key}
                  type="button"
                  onClick={run}
                  className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/50 px-4 py-3 text-left transition-colors hover:bg-muted/50 cursor-pointer"
                  data-testid={`button-empty-${testId}`}
                >
                  <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{label}</span>
                    <span className="block text-xs text-muted-foreground">{desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>

    <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
      <AlertDialogContent className="glass-dialog-card">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {deleteConfirm?.type === "conversation" ? "Remove conversation?" : deleteConfirm?.isMine ? "Delete message?" : "Hide message?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deleteConfirm?.type === "conversation"
              ? "This conversation will be removed from your list. You can still find it if they message you again."
              : deleteConfirm?.isMine
                ? "This will hide the message locally and request relays to delete it. The recipient may still have a copy."
                : "This will hide the message from your view. It won't affect the sender's copy."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground"
            onClick={() => {
              if (!deleteConfirm) return;
              if (deleteConfirm.type === "conversation") {
                handleDeleteConversation(deleteConfirm.id);
              } else {
                handleDeleteMessage(deleteConfirm.id, !!deleteConfirm.isMine);
              }
            }}
            data-testid="button-confirm-delete"
          >
            {deleteConfirm?.type === "conversation" ? "Remove" : deleteConfirm?.isMine ? "Delete" : "Hide"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* "New group chat" (from the + menu). Keeps CreateOutpostDialog's own
        post-create flow: navigate to /outposts/c/{id}?invite=1. */}
    <CreateOutpostDialog open={createGroupOpen} onOpenChange={setCreateGroupOpen} />

    {/* QR-scan + join-via-link sheets: state lifted from ChatList so the empty
        state and ChatList's "+" menu both drive this single render. */}
    {showQrScan && (
      <Suspense fallback={null}>
        <QrScanSheet onClose={() => setShowQrScan(false)} />
      </Suspense>
    )}
    {showJoinLink && (
      <Suspense fallback={null}>
        <JoinViaLinkDialog onClose={() => setShowJoinLink(false)} />
      </Suspense>
    )}
    </>
  );
}
