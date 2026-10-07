/**
 * The line of text under an Activity row (notification-preview.test.ts): the
 * reply, mention or reposted note, one line, with every `nostr:` address said
 * in words — the same rule as the chat list (lib/dm-text.ts).
 */
import { readableLine } from "./dm-text";

const MAX = 120;

export function notificationPreview(
  type: string,
  content: string | undefined,
  nameOf: (pubkey: string) => string | null | undefined,
): string | null {
  if (!content || type === "follow" || type === "ticket") return null;
  let text = content;
  if (type === "repost") {
    // A repost carries the note it reposts as JSON; many apps leave it out.
    try {
      const inner = JSON.parse(content)?.content;
      if (typeof inner !== "string") return null;
      text = inner;
    } catch {
      return null;
    }
  }
  // Name first, then shorten: shortening first can cut an address in half,
  // and half an address is no longer one the namer recognises.
  const line = readableLine(text, nameOf).trim();
  if (!line) return null;
  return line.length > MAX ? `${line.slice(0, MAX).trimEnd()}…` : line;
}
