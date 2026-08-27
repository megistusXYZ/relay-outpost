/**
 * Audio spaces — nostr voice rooms (Corny Chat, Nostr Nests, HiveTalk) as
 * first-class live things.
 *
 * Two consumers:
 *  - LinkPreviewCard: a room link in a post upgrades to a Join card instead
 *    of a generic gray link preview.
 *  - The live pipeline: a kind-30311 whose "stream URL" is actually a room
 *    PAGE must not be fed to a video player.
 *
 * Embeddability is a MEASURED allowlist (2026-08-26), not a guess:
 * cornychat.com serves no X-Frame-Options/CSP and can host an in-app room;
 * nostrnests.com sends X-Frame-Options: SAMEORIGIN and must open externally;
 * HiveTalk is unmeasured and treated external until someone measures it.
 * Re-measure before promoting a service to embeddable.
 */

export interface AudioSpace {
  /** Human service name for the card ("Corny Chat"). */
  service: string;
  /** Room identifier as the service names it. */
  room: string;
  /** Clean URL to join — tracking/query params dropped. */
  joinUrl: string;
  /** True only for services measured to allow framing. */
  embeddable: boolean;
}

interface ServiceDef {
  host: string;
  service: string;
  embeddable: boolean;
}

const SERVICES: ServiceDef[] = [
  { host: "cornychat.com", service: "Corny Chat", embeddable: true },
  { host: "nostrnests.com", service: "Nostr Nests", embeddable: false },
  { host: "hivetalk.org", service: "HiveTalk", embeddable: false },
];

/**
 * Is this parsed live event an audio ROOM rather than a video stream?
 * A room's streaming tag points at the room page itself; anything with a
 * playable media URL (hlsUrl set, or a media file extension) is video.
 */
export function isAudioSpace(stream: { streamUrl?: string; hlsUrl?: string }): boolean {
  if (stream.hlsUrl) return false;
  if (!stream.streamUrl) return false;
  if (/\.(m3u8|mp4|webm|ogg|flv|mov|m4v|mp3)(\?|$)/i.test(stream.streamUrl)) return false;
  return audioSpaceFromUrl(stream.streamUrl) !== null;
}

/**
 * Parse a URL into an audio space, or null when it isn't a room link.
 * The service landing page (no room path) is not a space.
 */
export function audioSpaceFromUrl(url: string): AudioSpace | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const def = SERVICES.find((s) => host === s.host || host.endsWith(`.${s.host}`));
  if (!def) return null;
  const room = decodeURIComponent(parsed.pathname.replace(/^\/+|\/+$/g, ""));
  if (!room) return null;
  return {
    service: def.service,
    room,
    joinUrl: `${parsed.origin}/${parsed.pathname.replace(/^\/+/, "")}`.replace(/\/+$/, ""),
    embeddable: def.embeddable,
  };
}
