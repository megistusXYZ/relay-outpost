/**
 * A profile's Audio tab: what it lists and counts, from three sources —
 * shows (live events they host or play in), audio in their own notes, and
 * their music on Wavlake.
 *
 * One rule ties them: the chip's count is what the tab lists. Abel James's
 * profile said "Audio 1" over "No audio published yet" — the 1 was a show that
 * ended without a recording, counted and then hidden.
 */
import type { MusicTrack } from "./music";
import type { LiveEventData } from "./live-events";

type Show = Pick<LiveEventData, "status" | "starts" | "event"> & { title: string };

export function profileShows<S extends Show>(streams: readonly S[] | undefined) {
  const all = streams ?? [];
  const when = (s: S) => s.starts ?? s.event?.created_at ?? 0;
  const liveNow = all.filter((s) => s.status === "live");
  const comingUp = all.filter((s) => s.status === "planned").sort((a, b) => when(a) - when(b));
  // Every past show, recording or not: a show they played is part of what
  // they've done, even when there's nothing to replay (the card says so).
  const past = all.filter((s) => s.status === "ended").sort((a, b) => when(b) - when(a));
  return { liveNow, comingUp, past, count: liveNow.length + comingUp.length + past.length };
}

const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|oga|flac|aac|opus)(\?[^\s]*)?$/i;

/** An audio file, by its name. */
export function isAudioUrl(url: string): boolean {
  try { return AUDIO_EXT.test(new URL(url).pathname); } catch { return false; }
}

interface NoteLike { id: string; pubkey: string; created_at: number; kind: number; content: string; tags: string[][] }

/**
 * Songs and recordings someone posted in their own notes: an audio file
 * linked in the text, or one the note declares (`imeta` with `m audio/*`,
 * which needs no file extension). Reposts aren't theirs.
 */
export function audioFromNotes(events: readonly NoteLike[], artist: string): MusicTrack[] {
  const out: MusicTrack[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.kind !== 1) continue;
    const urls: string[] = [];
    for (const t of ev.tags) {
      if (t[0] !== "imeta") continue;
      const kv = Object.fromEntries(t.slice(1).map((p) => [p.slice(0, p.indexOf(" ")), p.slice(p.indexOf(" ") + 1)]));
      if (kv.url && (/^audio\//i.test(kv.m ?? "") || (!kv.m && isAudioUrl(kv.url)))) urls.push(kv.url);
    }
    for (const m of ev.content.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []) if (isAudioUrl(m)) urls.push(m);
    const title = ev.content.split("\n").map((l) => l.replace(/https?:\/\/\S+/g, "").trim()).find(Boolean)?.slice(0, 120) || "Untitled";
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({
        id: `${ev.id}:${url}`, event: ev as MusicTrack["event"], title, artist, artistPubkey: ev.pubkey,
        audioUrl: url, coverUrl: "", description: ev.content, genre: "", duration: 0, createdAt: ev.created_at, source: "nostr",
      });
    }
  }
  return out;
}

export interface WavlakeArtistRow { id: string; name?: string | null; website?: string | null; npub?: string | null }

const host = (u: string | null | undefined) => {
  if (!u) return "";
  try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
};
const norm = (s: unknown) => (typeof s === "string" ? s.trim().toLowerCase().replace(/\s+/g, " ") : "");

/**
 * Someone's Wavlake artist page, when Wavlake doesn't name their Nostr account:
 * the SAME name and the SAME website on both. A name alone proves nothing
 * (anyone can call themselves Abel James); a website is the artist's own say
 * on both sides. Two candidates, or one that names another account, is no match.
 */
export function matchWavlakeArtist(
  profile: { name?: string; display_name?: string; website?: string },
  artists: readonly WavlakeArtistRow[],
): string | null {
  const site = host(profile.website);
  const names = new Set([norm(profile.display_name), norm(profile.name)].filter(Boolean));
  if (!site || names.size === 0) return null;
  const hits = artists.filter((a) => !(a.npub && a.npub.startsWith("npub1")) && names.has(norm(a.name)) && host(a.website) === site);
  return hits.length === 1 ? hits[0].id : null;
}
