/**
 * Keeping the Invite List (CORD-05 §4, kind 13303) and this device in step:
 * read the list, take up links made or turned off elsewhere, then write back
 * what only this device knows. concord-invite-list.ts holds the rules; the
 * relays, the link store and the device's memory are passed in.
 *
 * The list holds link secrets and is a replaceable event, so a bad write
 * erases links for good (RELAY_REACHABILITY.md):
 * - Nothing is written unless a relay answered.
 * - A list we can't open is never overwritten.
 * - A first list takes an answer from every relay and no memory of one here.
 */
import type { Event } from "nostr-tools";
import type { ISigner } from "applesauce-signers";
import { KIND_INVITE_LIST } from "./concord-events";
import { readInviteList, planInviteSync, type InviteList } from "./concord-invite-list";
import type { ListRelays } from "./community-list-sync";
import type { StoredInviteSigner } from "./concord-keys";

export type InviteStore = {
  all(): Promise<StoredInviteSigner[]>;
  put(link: StoredInviteSigner): Promise<void>;
};
export type InviteListMemory = { seen(): boolean; markSeen(): void };
export type InviteSyncResult =
  | { status: "unreachable" | "unreadable" | "no-encryption" }
  | { status: "synced"; written: boolean; adopted: number; revoked: number };

type Me = { signer: ISigner; pubkey: string };

export async function syncInviteList(
  me: Me,
  relays: ListRelays,
  store: InviteStore,
  memory: InviteListMemory,
  urlFor: (link: StoredInviteSigner) => string,
  nowMs = Date.now(),
): Promise<InviteSyncResult> {
  if (!me.signer.nip44) return { status: "no-encryption" };
  const { events, answered, allAnswered } = await relays.fetch({ kinds: [KIND_INVITE_LIST], authors: [me.pubkey] });
  if (!answered) return { status: "unreachable" };

  const newest = events
    .filter((e) => e.kind === KIND_INVITE_LIST && e.pubkey === me.pubkey)
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))[0];
  let remote: InviteList = { entries: [], tombstones: [] };
  if (newest) {
    let read: InviteList | null = null;
    try { read = readInviteList(await me.signer.nip44.decrypt(me.pubkey, newest.content)); } catch { /* not ours to read */ }
    if (!read) return { status: "unreadable" };
    remote = read;
    memory.markSeen();
  }

  const local = await store.all();
  const plan = planInviteSync(local, remote, urlFor);
  for (const link of plan.adopt) await store.put(link);
  const byPubkey = new Map(local.map((l) => [l.linkSignerPubkey, l]));
  for (const pk of plan.revoke) {
    const link = byPubkey.get(pk);
    if (link) await store.put({ ...link, revoked: true });
  }

  const mayWrite = !!newest || (allAnswered && !memory.seen());
  let written = false;
  if (plan.next && mayWrite && plan.next.entries.length + plan.next.tombstones.length > 0) {
    const content = await me.signer.nip44.encrypt(me.pubkey, JSON.stringify(plan.next));
    // Strictly newer than what it replaces, or a relay may keep the old one.
    const createdAt = Math.max(Math.floor(nowMs / 1000), (newest?.created_at ?? 0) + 1);
    const signed = await me.signer.signEvent({ kind: KIND_INVITE_LIST, created_at: createdAt, tags: [], content }) as Event;
    await relays.publish(signed);
    written = true;
    memory.markSeen();
  }
  return { status: "synced", written, adopted: plan.adopt.length, revoked: plan.revoke.length };
}
