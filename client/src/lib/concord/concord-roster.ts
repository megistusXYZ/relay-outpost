/**
 * Roster snapshots + the "present as person" rule for Concord group chats.
 *
 * A group with exactly TWO members (me + one other) reads as a direct chat:
 * the chat list and the group header show the OTHER member's name/avatar
 * instead of the group's. The live roster is folded by useConcordGovernance
 * from the control + guestbook planes, which only runs while a group is open —
 * so it persists a snapshot of member pubkeys here (localStorage, keyed by
 * community id) for the chat list to read without subscribing per group.
 *
 * Unknown/rosterless communities (never opened on this device, or the fold
 * hasn't seen the second member yet) fall back to the group presentation; the
 * moment a third member joins, `otherMemberFor` returns null and the group
 * presentation comes back automatically.
 */

/** window event fired (detail: communityId) whenever a snapshot changes. */
export const ROSTER_CHANGED_EVENT = "concord-roster-changed";

const key = (communityId: string) => `ro_concord_roster_${communityId}`;

/** Persist a community's member pubkeys (deduped, sorted). Empty rosters are
 *  ignored — a still-loading fold must not clobber a known snapshot. */
export function saveRosterSnapshot(communityId: string, members: readonly string[]): void {
  if (!communityId || members.length === 0) return;
  try {
    const next = JSON.stringify([...new Set(members)].sort());
    if (localStorage.getItem(key(communityId)) === next) return;
    localStorage.setItem(key(communityId), next);
    window.dispatchEvent(new CustomEvent(ROSTER_CHANGED_EVENT, { detail: communityId }));
  } catch { /* storage unavailable — presentation falls back to group */ }
}

/** The last-persisted member pubkeys for a community, or null when unknown. */
export function getRosterSnapshot(communityId: string): string[] | null {
  try {
    const raw = localStorage.getItem(key(communityId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every((p) => typeof p === "string")
      ? (parsed as string[])
      : null;
  } catch { return null; }
}

/**
 * The pure "present as person" decision: a group presents as its other member
 * iff the roster has exactly two distinct members and one of them is me.
 * Returns the other member's pubkey, or null for every fallback case
 * (unknown/empty roster, solo group, 3+ members, me not on the roster).
 *
 * @deprecated Retired for list/header identity in favour of the shared
 * group-name + facepile presentation (see `facepileMembers` / `resolveGroupName`).
 * Kept only so any remaining callers still type-check; every group — including
 * 2-person ones — now shows the SAME name to everyone.
 */
export function otherMemberFor(
  roster: readonly string[] | null | undefined,
  myPubkey: string | null | undefined,
): string | null {
  if (!roster || !myPubkey) return null;
  const distinct = [...new Set(roster)];
  if (distinct.length !== 2 || !distinct.includes(myPubkey)) return null;
  return distinct.find((p) => p !== myPubkey) ?? null;
}

/**
 * The pubkeys a group's facepile avatar should show, deterministic and
 * viewer-stable: dedupe, drop empties, put OTHER members first (sorted) so a
 * capped facepile always favours people who aren't you, then append your own
 * pubkey last (so small groups still include you — a 2-person group shows two
 * faces and can't be mistaken for a 1:1 DM). Capped at `cap` (default 3).
 */
export function facepileMembers(
  members: readonly string[] | null | undefined,
  myPubkey: string | null | undefined,
  cap = 3,
): string[] {
  const distinct = [...new Set((members ?? []).filter((p) => !!p))];
  const others = distinct.filter((p) => p !== myPubkey).sort();
  const self = myPubkey && distinct.includes(myPubkey) ? [myPubkey] : [];
  return [...others, ...self].slice(0, Math.max(0, cap));
}

/**
 * Join member display names into a deterministic, viewer-stable fallback label
 * for a group that was never given a name — sorted (locale-aware) so every
 * member computes the SAME string, capped with an ellipsis past `max`.
 */
export function joinMemberNames(names: readonly string[], max = 3): string {
  const cleaned = [...names].map((n) => n.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
  if (cleaned.length === 0) return "";
  const shown = cleaned.slice(0, max);
  return cleaned.length > shown.length ? `${shown.join(", ")}, …` : shown.join(", ");
}

/**
 * The single SHARED name every member should see for a group, in precedence
 * order: the live folded metadata name (authority-gated, wins on rename) →
 * the local stored record name → a deterministic join of member display names
 * (for a truly-unnamed group) → a generic last resort. Never viewer-specific.
 */
export function resolveGroupName(opts: {
  foldedName?: string | null;
  recordName?: string | null;
  memberNames?: readonly string[];
}): string {
  const folded = opts.foldedName?.trim();
  if (folded) return folded;
  const record = opts.recordName?.trim();
  if (record) return record;
  const joined = joinMemberNames(opts.memberNames ?? []);
  return joined || "Group chat";
}
