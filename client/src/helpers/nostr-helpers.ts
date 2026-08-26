import type { NostrEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";

export function decodeNpubToHex(npub: string): string | null {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === "npub") {
      return decoded.data as string;
    }
    return null;
  } catch {
    return null;
  }
}

export function getArticleTitle(event: NostrEvent): string | null {
  const tag = event.tags.find((t) => t[0] === "title");
  return tag?.[1] ?? null;
}

export function getArticleSummary(event: NostrEvent): string | null {
  const tag = event.tags.find((t) => t[0] === "summary");
  return tag?.[1] ?? null;
}

const IMAGE_URL_REGEX = /https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp)(?:\?\S*)?/i;

export function getEventImage(event: NostrEvent): string | null {
  const tag = event.tags.find((t) => t[0] === "image");
  if (tag?.[1]) {
    return tag[1];
  }

  const match = event.content.match(IMAGE_URL_REGEX);
  return match?.[0] ?? null;
}
