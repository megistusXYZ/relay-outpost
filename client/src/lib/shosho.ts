/**
 * Shosho (shosho.live) announcements. Shosho's bot posts a kind-1 — "<name>
 * is Live!", a picture, a link to the streamer's Shosho PAGE — and p-tags the
 * streamer; the stream itself is a separate kind-30311 live event, found by
 * the streamer's key. These two helpers are the pure part: is this link a
 * Shosho page, and who does the post say is live. Pure.
 */

const HEX64 = /^[0-9a-f]{64}$/;

/** The handle in a Shosho page link (https://shosho.live/<handle>), or null for anything else. */
export function shoshoHandle(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.hostname !== "shosho.live" && u.hostname !== "www.shosho.live") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length !== 1) return null;
  return /^[A-Za-z0-9_.-]{1,64}$/.test(parts[0]) ? parts[0] : null;
}

/** Who the post says is live: the first person it tags, or the poster themself. */
export function announcedHost(post: { pubkey: string; tags: string[][] }): string {
  for (const t of post.tags) {
    if (t[0] === "p" && typeof t[1] === "string" && HEX64.test(t[1]) && t[1] !== post.pubkey) return t[1];
  }
  return post.pubkey;
}
