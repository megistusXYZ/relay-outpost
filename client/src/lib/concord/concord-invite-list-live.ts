/**
 * The Invite List sync as the app runs it: your default relays (the same set
 * the Community List uses), the IndexedDB link store, and this device's memory
 * of having seen a list. The invite dialog runs it when it opens and after you
 * make or turn off a link.
 */
import type { ISigner } from "applesauce-signers";
import { getActiveDefaultRelays } from "@/lib/outpost-relays";
import { getAllInviteSigners, putInviteSigner, getCommunities } from "./concord-keys";
import { rebuildInviteLink } from "./concord-invites";
import { listRelaysAt } from "./community-list-live";
import { syncInviteList, type InviteSyncResult } from "./concord-invite-list-sync";

/** Fired when a sync took up or turned off a link on this device. */
export const INVITE_LIST_SYNCED_EVENT = "concord-invite-list-synced";

const seenKey = (pubkey: string) => `ro_concord_invite_list_seen_${pubkey}`;

const running = new Map<string, Promise<unknown>>();

/** One sync at a time per account: two at once would plan off the same read. */
export function syncInviteListNow(signer: ISigner, pubkey: string): Promise<InviteSyncResult> {
  const next = (running.get(pubkey) ?? Promise.resolve()).catch(() => {}).then(() => runOnce(signer, pubkey));
  running.set(pubkey, next);
  return next;
}

async function runOnce(signer: ISigner, pubkey: string): Promise<InviteSyncResult> {
  const groups = new Map((await getCommunities(pubkey)).map((c) => [c.community_id, c]));
  const result = await syncInviteList(
    { signer, pubkey },
    listRelaysAt(getActiveDefaultRelays()),
    { all: () => getAllInviteSigners(pubkey), put: (link) => putInviteSigner(pubkey, link) },
    {
      seen: () => { try { return localStorage.getItem(seenKey(pubkey)) === "1"; } catch { return false; } },
      markSeen: () => { try { localStorage.setItem(seenKey(pubkey), "1"); } catch { /* best-effort */ } },
    },
    (link) => {
      const group = groups.get(link.communityId);
      return group ? rebuildInviteLink(link, group, window.location.origin) : "";
    },
  );
  if (result.status === "synced" && result.adopted + result.revoked > 0) window.dispatchEvent(new Event(INVITE_LIST_SYNCED_EVENT));
  return result;
}
