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

export function anchorsGenesis(editions: ControlEdition[], bundle: Pick<InviteBundle, "community_id" | "owner">): boolean {
  const bound = editions.some((e) => e.vsk === VSK.METADATA && e.eid === bundle.community_id);
  const ownerSigned = editions.some((e) => e.pubkey === bundle.owner);
  return bound && ownerSigned;
}
