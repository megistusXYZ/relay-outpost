/**
 * Hangout rooms: a group room with a voice room attached, until Concord's own
 * voice (CORD-07) arrives. The voice room is a Corny Chat room at a random,
 * unguessable address, kept in the room's `custom` fields under this app's
 * prefix (CORD-02 §6), so only members ever see it and other Concord apps
 * show an ordinary text room. Voice itself is NOT end-to-end encrypted: Corny
 * Chat hosts it, and the UI says so.
 *
 * The address comes from whoever edited the room, so it is read strictly: an
 * https cornychat.com room and nothing else. A room admin must not be able to
 * make every member's app frame a site of their choosing.
 */
import { audioSpaceFromUrl, type AudioSpace } from "@/lib/audio-space";

/** This app's key in a room's custom fields. */
export const HANGOUT_KEY = "relayoutpost/hangout";

const HOST = "cornychat.com";
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ROOM_CHARS = 16;

/** A fresh Corny Chat room address: 16 random characters (about 82 bits). */
export function newHangoutUrl(): string {
  let room = "";
  while (room.length < ROOM_CHARS) {
    for (const b of crypto.getRandomValues(new Uint8Array(ROOM_CHARS))) {
      // 252 = 7 × 36: dropping the top four values keeps every character equally likely.
      if (b < 252 && room.length < ROOM_CHARS) room += ALPHABET[b % 36];
    }
  }
  return `https://${HOST}/ro-${room}`;
}

/** The custom fields that make a room a Hangout. */
export function hangoutCustom(url: string): Record<string, unknown> {
  return { [HANGOUT_KEY]: { url } };
}

/** The voice room a room carries, or null: only an https cornychat.com room that opens in the app. */
export function hangoutOf(channel: { custom?: Record<string, unknown> } | undefined): AudioSpace | null {
  const entry = channel?.custom?.[HANGOUT_KEY];
  const url = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as { url?: unknown }).url : undefined;
  if (typeof url !== "string") return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== HOST || parsed.port || parsed.username || parsed.password) return null;
  const space = audioSpaceFromUrl(url);
  return space?.embeddable ? space : null;
}
