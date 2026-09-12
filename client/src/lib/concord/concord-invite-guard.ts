/**
 * The two accept gates of CORD-05 §1 (upstream proposal #23; Vector and Armada
 * both enforce them). An invite hands over keys, and a link can be old,
 * forwarded, or hostile, so:
 *
 * - **The held-base rule.** An invite for a group you already hold may only
 *   add rooms you're missing. Its root, key version and admin address must
 *   match yours exactly, or it's refused and your record stays as it is — the
 *   base only ever moves by a rekey that extends the key you hold (CORD-06).
 *   Before this, opening an old link to a group you were in rewrote the stored
 *   record wholesale: keys rolled back, private rooms and the admin key gone.
 *
 * - **The genesis anchor.** A new join is kept only once the owner's own record
 *   opens under the keys the invite delivered: the group's metadata record
 *   (bound to its id) plus at least one record the owner signed. At epoch 0
 *   the owner's genesis metadata is both; after a key change it's the
 *   compaction pair. Absence-based: nothing found means wait, never admit.
 *
 * Pure. The relay read and the store live in concord-invites.
 */
import { VSK, type ControlEdition } from "./concord-events";
import type { InviteBundle } from "./concord-invites";
import type { StoredCommunity, StoredChannel } from "./concord-keys";

export type HeldCheck =
  | { kind: "new" }
  | { kind: "held"; record: StoredCommunity; added: number }
  | { kind: "refused" };

export function checkHeldBundle(held: StoredCommunity | null, bundle: InviteBundle): HeldCheck {
  if (!held) return { kind: "new" };
  const sameBase = bundle.community_root === held.community_root
    && bundle.root_epoch === held.root_epoch
    && (bundle.control_pk ?? undefined) === (held.control_pk ?? undefined);
  if (!sameBase) return { kind: "refused" };

  const have = new Set(held.channels.map((c) => c.id));
  const missing: StoredChannel[] = [];
  for (const ch of Array.isArray(bundle.channels) ? bundle.channels : []) {
    if (!ch || typeof ch.id !== "string" || have.has(ch.id)) continue;
    have.add(ch.id);
    missing.push({ id: ch.id, key: ch.key, epoch: ch.epoch, name: ch.name, isPrivate: !!ch.key });
  }
  if (missing.length === 0) return { kind: "held", record: held, added: 0 };
  return { kind: "held", record: { ...held, channels: [...held.channels, ...missing] }, added: missing.length };
}

/**
 * Rooms handed over in direct invites to a group you already hold. A private
 * room's key travels in an invite (CORD-03 §2, CORD-05 §6); Armada's "Add
 * members" sends one to people already in the group. Each invite passes the
 * held-base rule, and a room is taken only from someone who may hand it out.
 * `consumed` says the waiting invites can be cleared; one from someone not yet
 * allowed is kept, since their role may not have reached us.
 */
export function absorbHeldInvites(
  held: StoredCommunity,
  invites: { from: string; bundle: InviteBundle }[],
  mayGrant: (pubkey: string, roomId: string) => boolean,
): { record: StoredCommunity; added: number; consumed: boolean } {
  let record = held, added = 0, consumed = false;
  for (const inv of invites) {
    if (inv.bundle.community_id !== held.community_id) continue;
    const channels = (Array.isArray(inv.bundle.channels) ? inv.bundle.channels : [])
      .filter((ch) => ch && typeof ch.id === "string" && mayGrant(inv.from, ch.id));
    const check = checkHeldBundle(record, { ...inv.bundle, channels });
    if (check.kind === "refused") { consumed = true; continue; }
    if (check.kind !== "held") continue;
    if (channels.length > 0) consumed = true;
    record = check.record; added += check.added;
    // A room held here as public that the invite hands a key for: the group
    // made it private, on a new stream under that key. A private room moves
    // only to a newer generation: the counter is monotonic (CORD-03 §2), so an
    // older or equal epoch is a stale copy and never replaces the key I hold.
    for (const ch of channels) {
      if (typeof ch.key !== "string" || typeof ch.epoch !== "number") continue;
      const i = record.channels.findIndex((c) => c.id === ch.id && (!c.isPrivate || ch.epoch > c.epoch));
      if (i < 0) continue;
      const moved = { id: ch.id, key: ch.key, epoch: ch.epoch, name: ch.name ?? record.channels[i].name, isPrivate: true };
      record = { ...record, channels: record.channels.map((c, j) => (j === i ? moved : c)) };
      added += 1;
    }
  }
  return { record, added, consumed };
}

export function anchorsGenesis(editions: ControlEdition[], bundle: Pick<InviteBundle, "community_id" | "owner">): boolean {
  const bound = editions.some((e) => e.vsk === VSK.METADATA && e.eid === bundle.community_id);
  const ownerSigned = editions.some((e) => e.pubkey === bundle.owner);
  return bound && ownerSigned;
}
