/**
 * "Communities they're in" — the profile's community-adoption surface.
 *
 * Built ONLY from the subject's public kind-10009 groups list (what they
 * already told the network), reduced to outpost-level rows: the viewer's
 * shared communities first (mutual-servers social proof), then the rest as
 * one-tap join candidates. Deliberately not NIP-65: relay lists are
 * infrastructure, not places. Encrypted Concord communities never appear —
 * they are not in anyone's public list, by design.
 *
 * Both membership spellings are read: `group` tags (room joins) reduce to
 * their relay, and bare `r` tags (whole-outpost joins) count alone — reading
 * only `group` (parseSimpleGroupsList's job is different) would erase
 * outpost-only memberships. Tests: profile-communities.test.ts.
 */
import type { Event } from "nostr-tools";

export interface SubjectCommunityRow {
  url: string;
  /** The viewer is in this community too. */
  shared: boolean;
}

const norm = (raw: string): string | null => {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "wss:" && u.protocol !== "ws:") return null;
    return `${u.protocol}//${u.host}${u.pathname === "/" ? "" : u.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
};

export function subjectCommunityRows(
  listEvent: Event | null,
  viewerJoinedUrls: ReadonlySet<string>,
  max = 6,
): SubjectCommunityRow[] {
  if (!listEvent || listEvent.kind !== 10009) return [];
  const viewer = new Set(Array.from(viewerJoinedUrls, (u) => norm(u)).filter(Boolean) as string[]);
  const seen = new Set<string>();
  const rows: SubjectCommunityRow[] = [];
  for (const t of listEvent.tags) {
    const raw = t[0] === "group" ? t[2] : t[0] === "r" ? t[1] : undefined;
    if (!raw) continue;
    const url = norm(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    rows.push({ url, shared: viewer.has(url) });
  }
  rows.sort((a, b) => Number(b.shared) - Number(a.shared));
  return rows.slice(0, max);
}
