/**
 * Share-link encoding: every outward note link carries an nevent with the
 * relays the event was SEEN on plus the author — the two things a stranger's
 * client (ours included) needs to actually find the post. A bare id gave a
 * guest nothing to follow; the author enables NIP-65 outbox recovery even
 * when every hinted relay is gone. Articles already do this (parseArticle's
 * naddr carries relays + author by construction).
 */
import { nip19 } from "nostr-tools";

/** Seen-on urls → up to `max` shareable hints: ws(s) only, no loopback, deduped. */
export function pickShareHints(seenOn: readonly string[], max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of seenOn) {
    if (typeof raw !== "string" || !raw) continue;
    let u: URL;
    try { u = new URL(raw); } catch { continue; }
    if (u.protocol !== "wss:" && u.protocol !== "ws:") continue;
    const host = u.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) continue;
    const norm = `${u.protocol}//${u.host}${u.pathname === "/" ? "" : u.pathname}`;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= max) break;
  }
  return out;
}

/** nevent (id + author + hints) for share URLs; degrades to note1, then raw. */
export function noteShareId(id: string, author?: string, seenOn: readonly string[] = []): string {
  try {
    return nip19.neventEncode({ id, author, relays: pickShareHints(seenOn) });
  } catch {
    try { return nip19.noteEncode(id); } catch { return id; }
  }
}
