import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";

export function needsProxy(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes(".m3u8") || parsed.search.includes("m3u8")) return true;
    return false;
  } catch {
    return false;
  }
}

export function proxyUrl(url: string): string {
  return `/api/stream/proxy?url=${encodeURIComponent(url)}`;
}

export interface LiveEventData {
  id: string;
  pubkey: string;
  dTag: string;
  title: string;
  summary: string;
  image?: string;
  streamUrl?: string;
  hlsUrl?: string;
  recordingUrl?: string;
  starts?: number;
  ends?: number;
  status: "planned" | "live" | "ended";
  currentParticipants?: number;
  totalParticipants?: number;
  hashtags: string[];
  participants: { pubkey: string; role: string }[];
  relays: string[];
  chatEnabled: boolean;
  isZapStream: boolean;
  zapStreamNaddr?: string;
  event: Event;
}

/**
 * The HOST of a NIP-53 live stream is the human streamer — the participant
 * tagged `["p", <pubkey>, <relay?>, "host"]` — NOT `stream.pubkey`, which is
 * the AUTHOR of the kind-30311 event (often a publishing platform account such
 * as streamstr.net or zap.stream). Use this for all display/credit/share
 * tagging of "the streamer". Do NOT use it for event identity, the stream's
 * naddr/coordinate, liveness, or subscriptions — those key off the author.
 *
 * Matches the "host" role case-insensitively. If several hosts are tagged the
 * first wins. If no host participant exists, falls back to the author pubkey.
 */
/**
 * The playback source for a stream, status-aware. An ended stream's
 * `streaming` tag usually points at a dead HLS URL (platforms keep the tag
 * after the broadcast stops), while its `recording` tag holds the replay —
 * so once status is "ended" the recording wins. Live/planned keeps the
 * stream first. Undefined (never "") when nothing is playable.
 */
export function pickStreamSource(
  status: string | undefined,
  streamUrl: string | undefined,
  recordingUrl: string | undefined,
): string | undefined {
  const pick = status === "ended"
    ? (recordingUrl || streamUrl)
    : (streamUrl || recordingUrl);
  return pick || undefined;
}

/**
 * The streams that belong on a person's profile: ones they AUTHORED plus ones
 * where they are a tagged participant — most streams are published by a
 * platform account (zap.stream et al) with the human p-tagged, so authorship
 * alone finds almost nothing (the live-index lesson, applied to profiles).
 * 30311 is addressable: the NEWEST edition per author:dTag wins — never dTag
 * alone (two platforms can reuse a d value), and never first-seen (the newest
 * edition is the one carrying `ended` + the recording tag). Newest-first.
 */
export function streamsOfPerson(streams: LiveEventData[], pubkey: string): LiveEventData[] {
  const byCoord = new Map<string, LiveEventData>();
  for (const s of streams) {
    const theirs = s.pubkey === pubkey || s.participants.some((p) => p.pubkey === pubkey);
    if (!theirs) continue;
    const key = `${s.pubkey}:${s.dTag}`;
    const prev = byCoord.get(key);
    if (!prev || s.event.created_at > prev.event.created_at) byCoord.set(key, s);
  }
  return [...byCoord.values()].sort((a, b) => b.event.created_at - a.event.created_at);
}

/**
 * Can a <video>/<audio> element load this URL directly? A `recording` tag is
 * often a platform PAGE (YouTube watch link, Rumble page) — handing that to a
 * media element fails silently, leaving a play button that does nothing. Such
 * recordings must open externally instead.
 */
const DIRECT_MEDIA_EXT = /\.(m3u8|mp4|webm|mov|m4v|mp3|m4a|aac|ogg|wav|flac)(\?|#|$)/i;
export function isDirectMedia(url: string): boolean {
  return DIRECT_MEDIA_EXT.test(url);
}

export function getStreamHost(stream: Pick<LiveEventData, "pubkey" | "participants">): string {
  const host = stream.participants.find(p => p.role.toLowerCase() === "host");
  return host?.pubkey || stream.pubkey;
}

/**
 * All host/co-host pubkeys (case-insensitive "host" role), in tag order. Empty
 * if none are tagged.
 */
export function getStreamHosts(stream: Pick<LiveEventData, "participants">): string[] {
  return stream.participants.filter(p => p.role.toLowerCase() === "host").map(p => p.pubkey);
}

export function parseLiveEvent(event: Event): LiveEventData | null {
  const dTag = event.tags.find(t => t[0] === "d")?.[1];
  if (!dTag) return null;
  const title = event.tags.find(t => t[0] === "title")?.[1] || "Untitled Stream";
  const summary = event.tags.find(t => t[0] === "summary")?.[1] || "";
  const image = event.tags.find(t => t[0] === "image")?.[1];
  const allStreamingTags = event.tags.filter(t => t[0] === "streaming").map(t => t[1]);
  const streamUrl = allStreamingTags[0];
  const hlsUrl = allStreamingTags.find(u => u && (u.includes(".m3u8") || u.includes("m3u8")))
    || allStreamingTags.find(u => u && /\.(mp4|webm|ogg|flv)(\?|$)/i.test(u))
    || (event.tags.find(t => t[0] === "recording")?.[1] && /\.m3u8|\.mp4|\.webm/i.test(event.tags.find(t => t[0] === "recording")?.[1] || "") ? event.tags.find(t => t[0] === "recording")?.[1] : undefined);
  const recordingUrl = event.tags.find(t => t[0] === "recording")?.[1];

  const isZapStream = allStreamingTags.some(u => u && u.includes("zap.stream")) || allStreamingTags.some(u => u && u.includes("data.zap.stream"));
  let zapStreamNaddr: string | undefined;
  if (isZapStream) {
    try {
      const KIND_LIVE = 30311;
      zapStreamNaddr = nip19.naddrEncode({ identifier: dTag, pubkey: event.pubkey, kind: KIND_LIVE, relays: [] });
    } catch {}
  }
  const startsStr = event.tags.find(t => t[0] === "starts")?.[1];
  const endsStr = event.tags.find(t => t[0] === "ends")?.[1];
  const statusStr = event.tags.find(t => t[0] === "status")?.[1] || "live";
  const currentParticipantsStr = event.tags.find(t => t[0] === "current_participants")?.[1];
  const totalParticipantsStr = event.tags.find(t => t[0] === "total_participants")?.[1];
  const hashtags = event.tags.filter(t => t[0] === "t").map(t => t[1]);
  const participants = event.tags.filter(t => t[0] === "p").map(t => ({
    pubkey: t[1],
    role: t[3] || "Participant",
  }));
  const relays = event.tags.find(t => t[0] === "relays")?.slice(1) || [];
  const chatTagValue = event.tags.find(t => t[0] === "chat")?.[1];
  const chatEnabled = chatTagValue !== "disabled";

  let status: "planned" | "live" | "ended" = (statusStr === "planned" || statusStr === "live" || statusStr === "ended") ? statusStr : "live";

  if (status === "live") {
    const now = Math.floor(Date.now() / 1000);
    const eventAge = now - event.created_at;
    const startAge = startsStr ? now - parseInt(startsStr) : eventAge;
    // min() is what keeps long-running radios alive: platforms republish the
    // 30311 constantly (participant counts), so eventAge stays minutes even
    // when the stream started a year ago.
    const age = Math.min(eventAge, startAge);

    const hasStreamUrl = !!(streamUrl || hlsUrl);
    const hasTitle = title !== "Untitled Stream";
    const hasParticipantTracking = currentParticipantsStr != null;
    const endsTs = endsStr ? parseInt(endsStr) : undefined;

    if (!hasStreamUrl && !hasTitle && !hasParticipantTracking) {
      status = "ended";
    } else if (!hasStreamUrl && !hasParticipantTracking && age > 2 * 60 * 60) {
      status = "ended";
    } else if (age > 12 * 60 * 60) {
      // A liveness claim 12h past its last republish is stale no matter what
      // it carries — a participants tag used to immortalize these (the count
      // is only as fresh as the event that carries it), and a dead >24h
      // branch sat behind this one.
      status = "ended";
    } else if (endsTs != null && now > endsTs && eventAge > 2 * 60 * 60) {
      // The declared end passed and nothing has been republished since —
      // honor `ends` (it was parsed and never consulted). Running over is
      // normal, so a FRESH republish forgives a passed end.
      status = "ended";
    }
  }

  return {
    id: event.id,
    pubkey: event.pubkey,
    dTag,
    title,
    summary,
    image,
    streamUrl,
    hlsUrl,
    recordingUrl,
    starts: startsStr ? parseInt(startsStr) : undefined,
    ends: endsStr ? parseInt(endsStr) : undefined,
    status,
    currentParticipants: currentParticipantsStr ? parseInt(currentParticipantsStr) : undefined,
    totalParticipants: totalParticipantsStr ? parseInt(totalParticipantsStr) : undefined,
    hashtags,
    participants,
    relays,
    chatEnabled,
    isZapStream,
    zapStreamNaddr,
    event,
  };
}

/** Freshness window for an unverified liveness claim (see isShowableLive). */
const SHOWABLE_STALE_AGE = 2 * 60 * 60;

/**
 * The Live tab's single admission rule — previously duplicated verbatim in
 * the page's filter and its count, with a bug both copies shared: ANY
 * `current_participants` tag (including "0") bypassed the staleness gate
 * forever. The probe's positive answer always wins, its negative always
 * drops, and an unverified claim is only as fresh as its last republish —
 * a participants count carries no liveness of its own.
 */
export function isShowableLive(
  stream: Pick<LiveEventData, "status" | "starts" | "event">,
  liveness: "verified-live" | "offline" | "unknown",
  nowSec: number,
): boolean {
  if (stream.status !== "live") return false;
  if (liveness === "verified-live") return true;
  if (liveness === "offline") return false;
  const eventAge = nowSec - stream.event.created_at;
  const startAge = stream.starts ? nowSec - stream.starts : eventAge;
  return Math.min(eventAge, startAge) <= SHOWABLE_STALE_AGE;
}

/**
 * Whether an ended stream has a watchable replay. The DECLARED `recording`
 * tag is the signal — positive claims only: a leftover `streaming` tag on an
 * ended event is almost always a dead HLS URL (the #673 failure mode), and
 * probing hundreds of hosts from the client is neither fast nor honest.
 * The Past broadcasts tab lists only streams where this is true.
 */
export function hasReplay(stream: Pick<LiveEventData, "recordingUrl">): boolean {
  return !!stream.recordingUrl && stream.recordingUrl.trim().length > 0;
}
