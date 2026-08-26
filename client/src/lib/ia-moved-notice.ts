/**
 * The one-time "here's where things went" line, shown once to people whose
 * navigation collapsed underneath them.
 *
 * The collapse removes five entries from the nav. Nothing becomes unreachable —
 * Feed and News are Discover, Communities live in Chats, Calendar is a row
 * under You, and Media was always a tab of search — but reachable is not the
 * same as findable. Without a line saying so, "five sections vanished" reads as
 * breakage rather than as a redesign, and the first feedback you get is
 * confusion instead of an opinion.
 *
 * STORED PER ACCOUNT, never device-wide — the same rule as public-nostr. Two
 * people sharing a browser have two different sets of muscle memory; dismissing
 * this for one must not hide it from the other.
 *
 * NEW ACCOUNTS NEVER SEE IT. Nothing moved for someone who arrived after the
 * move, so CreateAccountFlow marks it seen at creation. That is why the notice
 * can ship before the global flip: it is inert for everyone until their nav
 * actually changes.
 */
const SEEN_PREFIX = "ro_ia_moved_seen:";
const SEEN = "1";

/** Per-account key. Null for a signed-out visitor — nothing moved for them. */
export function iaMovedNoticeKey(pubkey: string | null | undefined): string | null {
  if (!pubkey) return null;
  return `${SEEN_PREFIX}${pubkey}`;
}

/**
 * Should this person be told where things went?
 *
 * Pure so the rule is testable without a DOM: the caller supplies the stored
 * value. Only shows when the nav has ACTUALLY collapsed — a notice explaining a
 * change that hasn't happened is worse than no notice.
 */
export function shouldShowIaMovedNotice(opts: {
  pubkey: string | null | undefined;
  collapsed: boolean;
  stored: string | null | undefined;
}): boolean {
  if (!opts.pubkey) return false;
  if (!opts.collapsed) return false;
  return opts.stored !== SEEN;
}

export function hasSeenIaMovedNotice(pubkey: string | null | undefined): boolean {
  const key = iaMovedNoticeKey(pubkey);
  if (!key) return true;
  try {
    return localStorage.getItem(key) === SEEN;
  } catch {
    // Can't read? Assume seen. A notice that reappears every load because
    // storage is unavailable is a worse failure than one never shown.
    return true;
  }
}

export function markIaMovedNoticeSeen(pubkey: string | null | undefined): void {
  const key = iaMovedNoticeKey(pubkey);
  if (!key) return;
  try {
    localStorage.setItem(key, SEEN);
  } catch {}
}
