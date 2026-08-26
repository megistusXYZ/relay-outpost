/**
 * A LOCAL, per-device audit log of the direct (kind-3313) invites this admin has
 * sent from a given Concord community — the "who did I invite, and when" history
 * Concord has no protocol-level ledger for (gift wraps are addressed to the
 * recipient; there's no sender-side record).
 *
 * PRIVACY / SAFETY: this stores ONLY the recipient pubkey, a timestamp, and a
 * cached display name. It must NEVER store the invite bundle — that payload
 * carries the community's secret key material (community_root), same hazard the
 * received-side pending-invite store warns about. Local-only: it does not sync
 * across the admin's devices (a deliberate v1 scope).
 *
 * "Did they join?" is derived at render time by checking the recipient against
 * the live member roster (`isInGroup`) — we can't prove they used THIS invite,
 * only that they're now a member, so the UI says "In the group", not "accepted".
 */

export interface SentInvite {
  /** Recipient pubkey (hex). */
  recipient: string;
  /** When the invite was sent (ms epoch). */
  at: number;
  /** Cached display name at send time — best-effort label only. */
  name?: string;
}

/** Keep the log bounded — an admin who invites hundreds still gets a usable list. */
export const SENT_INVITES_CAP = 100;

const key = (owner: string, communityId: string) =>
  `ro_concord_sent_invites_${owner}_${communityId}`;

export function listSentInvites(owner: string, communityId: string): SentInvite[] {
  try {
    const raw = localStorage.getItem(key(owner, communityId));
    const parsed = raw ? (JSON.parse(raw) as SentInvite[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Record (or refresh) a sent direct invite. Deduped by recipient — re-inviting
 * the same person keeps ONE row and bumps it to the newest time/name. Newest
 * first; capped at {@link SENT_INVITES_CAP}. Only recipient/at/name are stored.
 */
export function recordSentInvite(owner: string, communityId: string, invite: SentInvite): void {
  try {
    const clean: SentInvite = invite.name
      ? { recipient: invite.recipient, at: invite.at, name: invite.name }
      : { recipient: invite.recipient, at: invite.at };
    const list = listSentInvites(owner, communityId).filter((s) => s.recipient !== clean.recipient);
    list.unshift(clean);
    localStorage.setItem(key(owner, communityId), JSON.stringify(list.slice(0, SENT_INVITES_CAP)));
  } catch {
    /* storage full / unavailable — the log is best-effort */
  }
}

export function removeSentInvite(owner: string, communityId: string, recipient: string): void {
  try {
    const list = listSentInvites(owner, communityId).filter((s) => s.recipient !== recipient);
    localStorage.setItem(key(owner, communityId), JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** Status: is this invited pubkey currently a member? (honest "in the group",
 *  not proof they used your invite). */
export function isInGroup(recipient: string, memberPubkeys: Set<string>): boolean {
  return memberPubkeys.has(recipient);
}
