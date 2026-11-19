/**
 * The Community List sync as the app runs it: your default relays, the
 * IndexedDB key store, and this device's memory (community-list-memory.ts).
 * main.tsx registers it, so every join, key change and leave reaches your other
 * devices through publishCommunityList; Chats runs it when it opens.
 */
import type { ISigner } from "applesauce-signers";
import { queryAnswered, canReachRelay } from "@/lib/relay-reach";
import { publishEvent } from "@/lib/nostr";
import { getActiveDefaultRelays } from "@/lib/outpost-relays";
import { getCommunities, putCommunity, deleteCommunity, updateCommunity } from "./concord-keys";
import { advanceRecord } from "./community-list";
import { syncList, type ListRelays, type ListSyncResult } from "./community-list-sync";
import { leftGroups, hasSeenList, markListSeen } from "./community-list-memory";

/** Fired when a sync added, dropped or advanced a group on this device. */
export const COMMUNITY_LIST_SYNCED_EVENT = "concord-community-list-synced";

/**
 * Your relays as the sync sees them. queryAnswered says whether ANY relay
 * asked sent its own end of stream; the sync needs more than that, because
 * only when EVERY one of your relays answered may it conclude that you have
 * no List yet. So each relay is proved reachable first, only those are asked,
 * and `allAnswered` takes all of them connecting and at least one answering.
 * That is still short of every one answering: a relay that connected and then
 * declined or stayed silent is counted in, as long as another one answered.
 */
export function listRelaysAt(urls: string[]): ListRelays {
  return {
    fetch: async (filter) => {
      const reachable = (await Promise.all(urls.map(async (u) => ((await canReachRelay(u)) ? u : null))))
        .filter((u): u is string => u !== null);
      if (reachable.length === 0) return { events: [], answered: false, allAnswered: false };
      const { events, answered } = await queryAnswered(reachable, filter);
      return { events, answered, allAnswered: answered && reachable.length === urls.length };
    },
    publish: async (event) => {
      if (!(await publishEvent(event, urls))) throw new Error("no relay accepted the list");
    },
  };
}

const running = new Map<string, Promise<unknown>>();

/** One sync at a time per account: two at once would plan off the same read. */
export function syncCommunityListNow(signer: ISigner, pubkey: string): Promise<ListSyncResult> {
  const next = (running.get(pubkey) ?? Promise.resolve()).catch(() => {}).then(() => runOnce(signer, pubkey));
  running.set(pubkey, next);
  return next;
}

async function runOnce(signer: ISigner, pubkey: string): Promise<ListSyncResult> {
  const result = await syncList(
    { signer, pubkey },
    listRelaysAt(getActiveDefaultRelays()),
    {
      all: () => getCommunities(pubkey),
      add: (record) => putCommunity(pubkey, record),
      remove: (id) => deleteCommunity(pubkey, id),
      // Inside the row's own transaction, so a field another writer changed
      // since our read survives (updateCommunity).
      advance: async (record) => {
        await updateCommunity(pubkey, record.community_id, (row) => (row.root_epoch >= record.root_epoch ? null : advanceRecord(row, record)));
      },
    },
    { left: () => leftGroups(pubkey), seen: () => hasSeenList(pubkey), markSeen: () => markListSeen(pubkey) },
  );
  if (result.status === "synced" && result.changedHere) window.dispatchEvent(new Event(COMMUNITY_LIST_SYNCED_EVENT));
  return result;
}
