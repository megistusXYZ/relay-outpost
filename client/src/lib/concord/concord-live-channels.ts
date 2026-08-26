/**
 * Stored record + governance fold → the channel list a viewer can actually act on.
 *
 * EXTRACTED, not copied. ConcordChat built this inline and the About-tab mount
 * passed `community.channels` raw into a prop whose own docstring says "The LIVE
 * channel list". Two consequences, both silent:
 *
 *  - every public channel a co-admin created was missing from that drawer, so
 *    the one surface built for managing channels hid the ones this device did
 *    not create;
 *  - the count fed to the channel-settings dialog came from the same raw list,
 *    which is what disables Delete with "needs at least one channel" while the
 *    drawer visibly lists several.
 *
 * That is `stored-record-vs-fold` again — the record is a join-time snapshot
 * nobody reconciles, and reading it as current is the defect this codebase has
 * now fixed five times. One implementation, called by both mounts, is the only
 * way the two surfaces stay honest with each other.
 *
 * Deliberately NOT reconciliation: it writes nothing. `concord-reconcile.ts`
 * decides what may be persisted back onto the record; this decides what to draw
 * right now, which is a live read and must work even when reconciliation has
 * not run (or never will, on a device that lost the election).
 */
import type { FoldedState } from "./concord-events";
import type { StoredCommunity, StoredChannel } from "./concord-keys";

export function liveChannels(community: StoredCommunity, gov: FoldedState): StoredChannel[] {
  // Folded names win over stored ones — a rename propagates, and a device that
  // never saw the rename still holds the key that makes the channel usable.
  const result = community.channels.map((c) => {
    const fc = gov.channels.get(c.id);
    return fc && fc.name ? { ...c, name: fc.name } : c;
  });
  const localIds = new Set(community.channels.map((c) => c.id));
  for (const fc of gov.channels.values()) {
    // PRIVATE channels are withheld on purpose: their key is not derivable from
    // `community_root`, so listing one would offer a row that opens nothing.
    // Absence here means "this device cannot read it", never "it was deleted".
    if (!localIds.has(fc.channel_id) && !fc.private) {
      result.push({
        id: fc.channel_id,
        epoch: community.root_epoch,
        name: fc.name || "channel",
        isPrivate: false,
      });
    }
  }
  return result;
}
