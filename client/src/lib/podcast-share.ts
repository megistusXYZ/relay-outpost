// Recover the playable episode from a shared "Discuss on Relay Outpost" note.
//
// When a podcast episode is shared, the kind-1 note carries the audio in
// standard tags — an `imeta` block (`url … m audio/… duration …`) plus an
// `["r", <audioUrl>]` reference, an image `imeta`/`r`, a NIP-73 `["i", anchor]`,
// and the episode title in the note body. The in-app reader opened from that
// note's link only had the page URL, so it treated the episode as an article
// and dropped the audio. This parser pulls the episode back OUT of the note's
// standard tags so the reader can offer a Listen tab — which also retroactively
// fixes every podcast link already shared.
//
// Pure + unit-tested; the network lookup that feeds it lives in external-comments.

export interface SharedPodcast {
  /** The episode media URL — the load-bearing field. */
  audioUrl: string;
  /** Cover art, if the note carried an image imeta/r. */
  image?: string;
  /** Episode title, recovered from the note body. */
  title?: string;
  /** Duration in seconds, if the audio imeta declared one. */
  duration?: number;
}

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;

/** Parse an `imeta` tag ("imeta", "url …", "m …", "duration …") into a kv map. */
function parseImeta(tag: string[]): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const entry of tag.slice(1)) {
    const sp = entry.indexOf(" ");
    if (sp > 0) kv[entry.slice(0, sp)] = entry.slice(sp + 1).trim();
  }
  return kv;
}

/** First body line that reads like the episode title — skips blank lines, bare
 *  URLs, and the 💬 / 🎙️ marker lines the share template adds. */
function titleFromContent(content: string | undefined): string | undefined {
  if (!content) return undefined;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^https?:\/\//i.test(line)) continue;
    if (line.startsWith("💬") || line.startsWith("🎙️") || line.startsWith("🎙")) continue;
    return line;
  }
  return undefined;
}

/**
 * Extract the shared episode from a note's tags + body, or null if the note has
 * no audio (i.e. it's a plain article share, not a podcast). Never throws.
 */
export function parseSharedPodcast(
  event: { tags?: string[][]; content?: string } | null | undefined,
): SharedPodcast | null {
  const tags = event?.tags;
  if (!Array.isArray(tags)) return null;

  let audioUrl: string | undefined;
  let image: string | undefined;
  let duration: number | undefined;

  // Prefer imeta blocks (they carry the mime + duration).
  for (const t of tags) {
    if (t[0] !== "imeta") continue;
    const kv = parseImeta(t);
    const url = kv.url;
    if (!url) continue;
    if (!audioUrl && kv.m?.startsWith("audio")) {
      audioUrl = url;
      const d = kv.duration ? parseInt(kv.duration, 10) : NaN;
      if (!Number.isNaN(d) && d > 0) duration = d;
    } else if (!image && (kv.m?.startsWith("image") || IMAGE_EXT.test(url))) {
      image = url;
    }
  }

  // Fall back to `r` references by file extension.
  if (!audioUrl || !image) {
    for (const t of tags) {
      if (t[0] !== "r" || !t[1]) continue;
      if (!audioUrl && AUDIO_EXT.test(t[1])) audioUrl = t[1];
      else if (!image && IMAGE_EXT.test(t[1])) image = t[1];
    }
  }

  if (!audioUrl) return null;
  return { audioUrl, image, title: titleFromContent(event?.content), duration };
}
