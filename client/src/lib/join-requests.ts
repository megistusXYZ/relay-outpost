/**
 * Request-to-join lifecycle for NIP-29 community relays (Buzz et al).
 *
 * A user asks to join from the members-only wall (kind 9021 — the same event
 * our AdmissionQueue shows operators on the other side). The request is
 * remembered here; later sweeps check the group's member list (a PUBLIC read
 * NIP-29 relays serve despite AUTH) and, on acceptance, the app joins the
 * outpost and tells the user in their notifications.
 *
 * Reach rules: an UNREACHED membership check resolves nothing — a request
 * stays pending until the relay actually answers. Requests quietly expire
 * after 30 days; silence from an operator is an answer too, and a year-old
 * "pending" would be noise.
 */

export interface PendingJoin {
  relayUrl: string;
  groupId: string;
  /** Community display name at request time — what the notification says. */
  name: string;
  requestedAt: number;
}

export interface AcceptedJoin extends PendingJoin {
  acceptedAt: number;
  seen: boolean;
}

const PENDING_KEY = (pk: string) => `ro_join_pending_${pk}`;
const ACCEPTED_KEY = (pk: string) => `ro_join_accepted_${pk}`;
const EXPIRY_SECONDS = 30 * 86400;

function readList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, list: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch { /* storage unavailable */ }
}

const sameTarget = (a: { relayUrl: string; groupId: string }, relayUrl: string, groupId: string) =>
  a.relayUrl === relayUrl && a.groupId === groupId;

export function readPendingJoins(pubkey: string): PendingJoin[] {
  return readList<PendingJoin>(PENDING_KEY(pubkey));
}

export function addPendingJoin(pubkey: string, join: PendingJoin): void {
  const list = readPendingJoins(pubkey).filter((x) => !sameTarget(x, join.relayUrl, join.groupId));
  list.push(join);
  writeList(PENDING_KEY(pubkey), list);
}

export function removePendingJoin(pubkey: string, relayUrl: string, groupId: string): void {
  writeList(PENDING_KEY(pubkey), readPendingJoins(pubkey).filter((x) => !sameTarget(x, relayUrl, groupId)));
}

/**
 * Split pending requests by what the relay ACTUALLY said:
 *  - membership(p) === true  → accepted;
 *  - membership(p) === false → still pending (asked, not in yet);
 *  - membership(p) === null  → the check never got an answer: still pending,
 *    claimed nothing.
 * Requests older than 30 days are dropped from both lists.
 */
export function resolveAcceptances(
  pending: PendingJoin[],
  membership: (p: PendingJoin) => boolean | null,
  nowSeconds: number,
): { accepted: PendingJoin[]; stillPending: PendingJoin[] } {
  const accepted: PendingJoin[] = [];
  const stillPending: PendingJoin[] = [];
  for (const p of pending) {
    if (nowSeconds - p.requestedAt > EXPIRY_SECONDS) continue;
    const inGroup = membership(p);
    if (inGroup === true) accepted.push(p);
    else stillPending.push(p);
  }
  return { accepted, stillPending };
}

export function readAcceptedJoins(pubkey: string): AcceptedJoin[] {
  return readList<AcceptedJoin>(ACCEPTED_KEY(pubkey));
}

export function recordAcceptance(pubkey: string, join: PendingJoin, acceptedAt: number): void {
  const list = readAcceptedJoins(pubkey).filter((x) => !sameTarget(x, join.relayUrl, join.groupId));
  list.push({ ...join, acceptedAt, seen: false });
  writeList(ACCEPTED_KEY(pubkey), list);
  removePendingJoin(pubkey, join.relayUrl, join.groupId);
  // The notification slice listens for this to re-derive.
  try { window.dispatchEvent(new CustomEvent("relay-outpost:join-accepted")); } catch { /* SSR/tests */ }
}

export function markAcceptedSeen(pubkey: string, relayUrl: string, groupId: string): void {
  writeList(
    ACCEPTED_KEY(pubkey),
    readAcceptedJoins(pubkey).map((x) => (sameTarget(x, relayUrl, groupId) ? { ...x, seen: true } : x)),
  );
  try { window.dispatchEvent(new CustomEvent("relay-outpost:join-accepted")); } catch { /* SSR/tests */ }
}

// ── Orchestration (IO) ───────────────────────────────────────────────────────
import { fetchGroupMembersResult } from "@/lib/nip29";
import { joinOutpost } from "@/lib/outpost-relays";

/**
 * Check every pending request against the relay's member list (public read).
 * Acceptance = the app joins the outpost for them and records a notification.
 * Unreached relays resolve nothing. Returns the newly accepted requests.
 */
export async function checkPendingJoins(pubkey: string): Promise<PendingJoin[]> {
  const pending = readPendingJoins(pubkey);
  if (pending.length === 0) return [];
  const now = Math.floor(Date.now() / 1000);

  const memberships = new Map<string, boolean | null>();
  await Promise.all(pending.map(async (p) => {
    try {
      const res = await fetchGroupMembersResult(p.relayUrl, p.groupId);
      memberships.set(`${p.relayUrl}|${p.groupId}`, res.reached ? res.data.includes(pubkey) : null);
    } catch {
      memberships.set(`${p.relayUrl}|${p.groupId}`, null);
    }
  }));

  const { accepted, stillPending } = resolveAcceptances(
    pending,
    (p) => memberships.get(`${p.relayUrl}|${p.groupId}`) ?? null,
    now,
  );

  // Persist the pruned pending list (drops 30-day expiries too).
  writeList(PENDING_KEY(pubkey), stillPending);

  for (const a of accepted) {
    // They're in: the community joins their list, and the bell tells them.
    joinOutpost(a.relayUrl, a.name, "private", pubkey);
    recordAcceptance(pubkey, a, now);
  }
  return accepted;
}
